import crypto from "crypto";
import supabase from "../services/supabase";
import logger from "../utils/logger";
import { fetchNewMessages, ImapCredentialRow } from "../services/imap";
import { ingestMessage } from "../services/inboxIngest";
import { getUserPlan, getFeatureAccess, checkSubscriptionAccess } from "../services/planLimits";

// =============================================
// Reply fetcher — polls every connected IMAP inbox for replies to our outreach
// =============================================
// Runs every 2 minutes alongside the email queue and CSV drip-feed, under its own
// distributed lock ('reply_fetch' row in job_locks). Credentials are processed one at a time
// with a hard per-credential timeout; one broken mailbox never affects the others.

const LOCK_NAME = "reply_fetch";
const INSTANCE_ID = `rf_${crypto.randomBytes(4).toString("hex")}_${process.pid}`;
const INTERVAL_MS = 2 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 60 * 1000;
const PER_CREDENTIAL_TIMEOUT_MS = 60 * 1000;
// After this many consecutive failures we stop polling the credential until the user
// re-connects it (keeps a dead mailbox from burning a minute every cycle forever).
const MAX_CONSECUTIVE_FAILURES = 20;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

// Feature gate: the Unified Inbox is a Growth+ feature (trial included). A user who
// downgraded or whose subscription lapsed stops being polled — no silent data collection
// for a feature they can't see.
const accessCache = new Map<string, { ok: boolean; at: number }>();
async function userHasInboxAccess(userId: string): Promise<boolean> {
  const cached = accessCache.get(userId);
  if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.ok;
  let ok = false;
  try {
    const sub = await checkSubscriptionAccess(userId);
    if (sub.hasAccess) {
      const plan = await getUserPlan(userId);
      ok = getFeatureAccess(plan.plan, plan.isOnTrial).unifiedInbox;
    }
  } catch { ok = false; }
  accessCache.set(userId, { ok, at: Date.now() });
  return ok;
}

async function processCredential(cred: ImapCredentialRow): Promise<void> {
  if (!(await userHasInboxAccess(cred.user_id))) {
    logger.debug({ credentialId: cred.id }, "Reply fetch skipped — inbox feature not available for user");
    return;
  }

  const startedAt = Date.now();
  const { messages, maxUid } = await withTimeout(fetchNewMessages(cred), PER_CREDENTIAL_TIMEOUT_MS, "IMAP fetch");

  let stored = 0;
  for (const msg of messages) {
    try {
      if (await ingestMessage(cred, msg)) stored += 1;
    } catch (err) {
      logger.warn({ err, credentialId: cred.id, uid: msg.uid }, "Failed to ingest message");
    }
  }

  await supabase
    .from("imap_credentials")
    .update({
      last_fetched_at: new Date().toISOString(),
      last_uid: maxUid ?? cred.last_uid ?? null,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", cred.id);

  if (messages.length > 0 || stored > 0) {
    logger.info({ credentialId: cred.id, email: cred.email, fetched: messages.length, stored, ms: Date.now() - startedAt }, "Reply fetch complete");
  }
}

const failureCounts = new Map<string, number>();

async function runReplyFetch(): Promise<void> {
  const { data: acquired } = await supabase.rpc("acquire_job_lock", { p_lock_name: LOCK_NAME, p_locked_by: INSTANCE_ID });
  if (!acquired) {
    logger.debug("Reply fetcher: another instance holds the lock, skipping cycle");
    return;
  }

  const heartbeat = setInterval(() => {
    supabase.rpc("heartbeat_job_lock", { p_lock_name: LOCK_NAME, p_locked_by: INSTANCE_ID }).then(() => {}, () => {});
  }, HEARTBEAT_INTERVAL_MS);

  try {
    const { data: creds, error } = await supabase
      .from("imap_credentials")
      .select("*")
      .eq("is_active", true)
      .order("last_fetched_at", { ascending: true, nullsFirst: true });
    if (error || !creds || creds.length === 0) return;

    for (const cred of creds as ImapCredentialRow[]) {
      try {
        await processCredential(cred);
        failureCounts.delete(cred.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const failures = (failureCounts.get(cred.id) || 0) + 1;
        failureCounts.set(cred.id, failures);
        const deactivate = failures >= MAX_CONSECUTIVE_FAILURES || /authenticationfailed|invalid credentials|\[AUTHENTICATIONFAILED\]/i.test(msg);
        await supabase
          .from("imap_credentials")
          .update({
            last_error: deactivate
              ? "Inbox disconnected: sign-in keeps failing. Reconnect it from Settings with a fresh app password."
              : "Could not check this inbox on the last attempt. Will retry automatically.",
            ...(deactivate ? { is_active: false } : {}),
            updated_at: new Date().toISOString(),
          })
          .eq("id", cred.id);
        logger.warn({ credentialId: cred.id, email: cred.email, failures, deactivated: deactivate, error: msg }, "Reply fetch failed for credential");
      }
    }
  } catch (err) {
    logger.error({ err }, "Reply fetcher cycle failed");
  } finally {
    clearInterval(heartbeat);
    try {
      await supabase.rpc("release_job_lock", { p_lock_name: LOCK_NAME, p_locked_by: INSTANCE_ID });
    } catch { /* lock auto-expires */ }
  }
}

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startReplyFetcher(): void {
  if (intervalId) {
    logger.info("Reply fetcher already running");
    return;
  }
  logger.info("Reply fetcher started (interval: 120s)");
  // Stagger the first run so it doesn't collide with the email queue's boot cycle.
  setTimeout(() => { runReplyFetch(); }, 20 * 1000);
  intervalId = setInterval(runReplyFetch, INTERVAL_MS);
}

export function stopReplyFetcher(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info("Reply fetcher stopped");
  }
}
