import supabase from "./supabase";
import logger from "../utils/logger";
import { getDodoClient, getPlanFromProduct, describeDodoError } from "./dodo";

// =============================================
// Billing reconciliation — the safety net under the webhooks
// =============================================
// Webhooks are the fast path, but a missed or ignored delivery otherwise leaves user_plans
// wrong forever (an "active" row keeps granting access regardless of dates). This module asks
// Dodo for the subscription's REAL state and corrects the row when they disagree.
//
// Runs (a) when a user loads /api/stats (Settings/Dashboard), throttled per user, and
// (b) once a day for every row that has a Dodo id (jobs started from server.ts).
//
// Rules, in order:
//   1. Follow the customer's NEWEST real subscription (pending/failed = abandoned checkouts are
//      ignored). If it differs from the one the row points at, relink (the checkout webhook
//      that normally does this was missed). Newest wins even when it is cancelled — that is
//      the truth about the account, not an older subscription that happens to look alive.
//   2. Mirror the linked subscription's status:
//        active + cancel_at_next_billing_date=false → active
//        active + cancel_at_next_billing_date=true  → cancelled (access until next_billing_date)
//        cancelled/expired                           → cancelled while next_billing_date is in the
//                                                      future, otherwise expired
//        on_hold                                      → past_due
//   3. Never touches trial rows (no Dodo id) — the app owns the trial.

const PER_USER_THROTTLE_MS = 10 * 60 * 1000; // at most one Dodo round-trip per user per 10 min
const lastChecked = new Map<string, number>();

interface SubLike {
  subscription_id: string;
  status: string;
  cancel_at_next_billing_date: boolean;
  next_billing_date: string;
  previous_billing_date: string;
  product_id: string;
  created_at: string;
  customer?: { customer_id?: string };
}

function toRow(sub: SubLike): Record<string, unknown> {
  const periodEnd = sub.next_billing_date || null;
  const periodStart = sub.previous_billing_date || sub.created_at || null;
  const endsInFuture = !!periodEnd && new Date(periodEnd).getTime() > Date.now();

  let status: string;
  switch (sub.status) {
    case "active":
      status = sub.cancel_at_next_billing_date ? "cancelled" : "active";
      break;
    case "on_hold":
      status = "past_due";
      break;
    case "cancelled":
      status = endsInFuture ? "cancelled" : "expired";
      break;
    case "expired":
      status = "expired";
      break;
    default: // pending | failed — no paid access
      status = "expired";
  }

  return {
    plan: getPlanFromProduct(sub.product_id),
    subscription_status: status,
    dodo_subscription_id: sub.subscription_id,
    ...(sub.customer?.customer_id ? { dodo_customer_id: sub.customer.customer_id } : {}),
    current_period_start: periodStart,
    current_period_end: periodEnd,
    trial_ends_at: null,
    updated_at: new Date().toISOString(),
  };
}

export interface ReconcileResult {
  checked: boolean;
  changed: boolean;
  from?: string;
  to?: string;
  relinked?: boolean;
}

// Reconcile one user. `force` bypasses the per-user throttle (daily job uses it).
export async function reconcileUserBilling(userId: string, force = false): Promise<ReconcileResult> {
  const now = Date.now();
  if (!force && now - (lastChecked.get(userId) || 0) < PER_USER_THROTTLE_MS) return { checked: false, changed: false };
  lastChecked.set(userId, now);

  const { data: row } = await supabase
    .from("user_plans")
    .select("subscription_status, plan, dodo_subscription_id, dodo_customer_id, current_period_end")
    .eq("user_id", userId)
    .single();
  if (!row || (!row.dodo_subscription_id && !row.dodo_customer_id)) return { checked: false, changed: false };

  const dodo = getDodoClient();
  let target: SubLike | null = null;
  let relinked = false;

  try {
    // 1. Newest real subscription for this customer (catches a missed checkout webhook)
    if (row.dodo_customer_id) {
      const page = await dodo.subscriptions.list({ customer_id: row.dodo_customer_id, page_size: 50 } as any);
      const items = ((page as any).items || []) as SubLike[];
      const real = items
        .filter((s) => s.status !== "pending" && s.status !== "failed") // abandoned checkouts
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      if (real[0]) {
        target = real[0];
        relinked = target.subscription_id !== row.dodo_subscription_id;
      }
    }
    // 2. Otherwise the subscription the row already points at
    if (!target && row.dodo_subscription_id) {
      target = (await dodo.subscriptions.retrieve(row.dodo_subscription_id)) as unknown as SubLike;
    }
  } catch (err) {
    logger.warn({ userId, dodo: describeDodoError(err) }, "Billing reconcile: Dodo lookup failed");
    return { checked: false, changed: false };
  }
  if (!target) return { checked: true, changed: false };

  const next = toRow(target);
  // Compare dates by instant, not string: Dodo returns "...Z", Postgres returns "...+00:00".
  const sameInstant = (a: unknown, b: unknown) => {
    const ta = a ? new Date(String(a)).getTime() : 0;
    const tb = b ? new Date(String(b)).getTime() : 0;
    return ta === tb;
  };
  const unchanged =
    next.subscription_status === row.subscription_status &&
    next.dodo_subscription_id === row.dodo_subscription_id &&
    next.plan === row.plan &&
    sameInstant(next.current_period_end, row.current_period_end);
  if (unchanged) return { checked: true, changed: false };

  const { error } = await supabase.from("user_plans").update(next).eq("user_id", userId);
  if (error) {
    logger.warn({ userId, error: error.message }, "Billing reconcile: update failed");
    return { checked: true, changed: false };
  }
  logger.info(
    { userId, from: row.subscription_status, to: next.subscription_status, relinked, subscriptionId: target.subscription_id },
    "Billing reconciled with Dodo"
  );
  return { checked: true, changed: true, from: row.subscription_status, to: String(next.subscription_status), relinked };
}

// Daily sweep over every row that has a Dodo id.
async function reconcileAll(): Promise<void> {
  const { data: rows } = await supabase
    .from("user_plans")
    .select("user_id")
    .or("dodo_subscription_id.not.is.null,dodo_customer_id.not.is.null");
  let changed = 0;
  for (const r of rows || []) {
    try {
      const res = await reconcileUserBilling(r.user_id, true);
      if (res.changed) changed += 1;
    } catch (err) {
      logger.warn({ err, userId: r.user_id }, "Billing reconcile failed for user");
    }
    await new Promise((r) => setTimeout(r, 250)); // be gentle with Dodo's rate limits
  }
  logger.info({ users: rows?.length || 0, changed }, "Daily billing reconciliation complete");
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startBillingSync(): void {
  if (timer) return;
  if (!process.env.DODO_PAYMENTS_API_KEY) {
    logger.info("Billing sync not started (DODO_PAYMENTS_API_KEY missing)");
    return;
  }
  logger.info("Billing sync started (daily)");
  setTimeout(() => { reconcileAll().catch(() => {}); }, 2 * 60 * 1000); // first pass 2 min after boot
  timer = setInterval(() => { reconcileAll().catch(() => {}); }, 24 * 60 * 60 * 1000);
}

export function stopBillingSync(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
