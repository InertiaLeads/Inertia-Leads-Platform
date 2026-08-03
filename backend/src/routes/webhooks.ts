import { Router, Request, Response } from "express";
import { Webhook } from "standardwebhooks";
import supabaseAdmin from "../services/supabase";
import { getPlanFromProduct, mapDodoStatus, getDodoClient, describeDodoError } from "../services/dodo";
import logger from "../utils/logger";

const router = Router();

// Kill a subscription at Dodo immediately (not at period end).
//
// Note this is deliberately different from the user-initiated cancel in routes/billing.ts,
// which sets `cancel_at_next_billing_date: true` so the customer keeps what they paid for.
// Here the subscription is dead — its payment failed, or it was abandoned when the customer
// re-subscribed — so it must stop billing right now.
//
// Never throws: a webhook must still acknowledge (200) and revoke access even if this call
// fails, otherwise Dodo retries forever and the user stays wrongly active. Returns whether
// the cancellation succeeded so the caller can log it.
async function cancelSubscriptionNow(subscriptionId: string, reason: string): Promise<boolean> {
  if (!subscriptionId) return false;
  try {
    await getDodoClient().subscriptions.update(subscriptionId, {
      status: "cancelled",
      cancel_reason: "cancelled_by_merchant",
    });
    logger.info({ subscriptionId, reason }, "Stale subscription cancelled at Dodo");
    return true;
  } catch (err: any) {
    // Already cancelled/expired subscriptions return a 4xx — that's the desired end state,
    // so treat it as success rather than noise.
    const statusCode = err?.status ?? err?.statusCode;
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      logger.info(
        { subscriptionId, reason, statusCode },
        "Dodo rejected cancellation (already inactive) — treating as done"
      );
      return true;
    }
    logger.error(
      { subscriptionId, reason, dodo: describeDodoError(err) },
      "FAILED to cancel stale subscription at Dodo — it may keep billing; cancel it manually"
    );
    return false;
  }
}

// Verify a Dodo webhook. Dodo follows the Standard Webhooks spec: the signature is
// an HMAC-SHA256 over `${webhook-id}.${webhook-timestamp}.${rawBody}`, carried in the
// `webhook-signature` header. The `standardwebhooks` lib does the exact check + timing-safe
// compare. Returns the parsed event on success, or null if verification fails.
function verifyDodoWebhook(rawBody: string, headers: Request["headers"]): any | null {
  const secret = process.env.DODO_WEBHOOK_SECRET;
  if (!secret) {
    logger.error("DODO_WEBHOOK_SECRET not configured");
    return null;
  }
  try {
    const wh = new Webhook(secret);
    return wh.verify(rawBody, {
      "webhook-id": headers["webhook-id"] as string,
      "webhook-signature": headers["webhook-signature"] as string,
      "webhook-timestamp": headers["webhook-timestamp"] as string,
    });
  } catch {
    return null;
  }
}

// POST /api/webhooks/dodo
// Must NOT have auth middleware — Dodo calls this directly, server-to-server.
router.post("/", async (req: Request, res: Response) => {
  try {
    const rawBody = (req as any).rawBody as string;
    if (!rawBody) {
      logger.error("Raw body not available for webhook verification");
      return res.status(500).json({ error: "Server configuration error" });
    }

    const event = verifyDodoWebhook(rawBody, req.headers);
    if (!event) {
      logger.warn("Dodo webhook signature verification failed");
      return res.status(401).json({ error: "Invalid signature" });
    }

    const eventType: string = event?.type || "";
    const data = event?.data || {};

    // user_id was attached as checkout metadata so we can resolve the account.
    const userId = data?.metadata?.user_id;
    if (!userId) {
      logger.warn({ eventType }, "Webhook received without user_id in metadata");
      return res.status(200).json({ received: true }); // Acknowledge but skip
    }

    const subscriptionId = String(data?.subscription_id || "");
    const customerId = String(data?.customer?.customer_id || data?.customer_id || "");
    const productId = String(data?.product_id || "");
    const status = data?.status || "";
    const currentPeriodStart = data?.previous_billing_date || data?.created_at || null;
    // Prefer Dodo's real next billing date; fall back to start + 30 days so expiry is
    // never null/inconsistent with the purchase date (same fallback as before).
    const currentPeriodEnd =
      data?.next_billing_date ||
      (currentPeriodStart
        ? new Date(new Date(currentPeriodStart).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
        : null);

    logger.info({ eventType, userId, status, subscriptionId }, "Dodo webhook received");

    // ===== Stale-subscription guard =====
    // Every event must apply to the subscription this account currently holds. Without
    // this, an ABANDONED subscription keeps mutating a live account: a user whose card
    // failed re-subscribes, then the old subscription emits its own `subscription.expired`
    // (or `cancelled`) and silently kills the new, paid plan.
    //
    // `subscription.active` is exempt — it is the event that legitimately establishes a new
    // subscription ID on the row, so it must be allowed to run before any ID exists.
    //
    // The two event classes need DIFFERENT rules, and conflating them breaks checkout:
    //
    //  - REVOKING events must match exactly, and are dropped when the row holds no id.
    //    "No id" means there is no subscription to revoke. This is also what swallows the
    //    `subscription.cancelled` echo of our own payment.failed cancellation — without it
    //    that echo would set status 'cancelled' with a future current_period_end and hand
    //    access straight back to someone whose card just failed.
    //
    //  - GRANTING events are dropped only when the row holds a DIFFERENT id. They must be
    //    allowed through when the row's id is still null, because `payment.succeeded` can
    //    arrive BEFORE `subscription.active`. Requiring a match there would drop the
    //    payment confirmation of a brand-new subscription, leaving a customer who was
    //    charged sitting on "no active plan".
    const REVOKING_EVENTS = [
      "payment.failed",
      "subscription.on_hold",
      "subscription.cancelled",
      "subscription.expired",
    ];

    if (eventType !== "subscription.active" && subscriptionId) {
      const { data: currentRow } = await supabaseAdmin
        .from("user_plans")
        .select("dodo_subscription_id")
        .eq("user_id", userId)
        .single();

      const activeId = currentRow?.dodo_subscription_id || null;
      const isRevoking = REVOKING_EVENTS.includes(eventType);
      const stale = isRevoking ? activeId !== subscriptionId : !!activeId && activeId !== subscriptionId;

      if (stale) {
        logger.info(
          { eventType, userId, eventSubscriptionId: subscriptionId, activeSubscriptionId: activeId, isRevoking },
          "Ignoring webhook for a subscription this account no longer holds"
        );
        return res.status(200).json({ received: true });
      }
    }

    switch (eventType) {
      case "subscription.active": {
        // First activation of a paid subscription. The app owns the trial, so a paid
        // sub always clears trial_ends_at and lands on 'active'.

        // Safety net: this is the one place a subscription ID gets overwritten, so it's the
        // last chance to notice an older one. If the row still holds a DIFFERENT id, that
        // subscription is about to become unreachable — we'd lose the only reference to it
        // and it could keep billing. Kill it first. Normally payment.failed already did,
        // so this only fires if that event was missed, delayed, or arrived out of order.
        const { data: priorRow } = await supabaseAdmin
          .from("user_plans")
          .select("dodo_subscription_id")
          .eq("user_id", userId)
          .single();

        const priorSubscriptionId = priorRow?.dodo_subscription_id || null;
        if (priorSubscriptionId && priorSubscriptionId !== subscriptionId) {
          logger.warn(
            { userId, priorSubscriptionId, newSubscriptionId: subscriptionId },
            "Account is being replaced onto a new subscription — cancelling the previous one"
          );
          await cancelSubscriptionNow(priorSubscriptionId, "superseded by a new subscription");
        }

        const plan = getPlanFromProduct(productId);
        await supabaseAdmin
          .from("user_plans")
          .update({
            plan,
            subscription_status: mapDodoStatus(status),
            dodo_subscription_id: subscriptionId,
            dodo_customer_id: customerId,
            trial_ends_at: null,
            current_period_end: currentPeriodEnd,
            current_period_start: currentPeriodStart,
            past_due_since: null,
          })
          .eq("user_id", userId);
        logger.info({ userId, plan }, "Subscription active");
        break;
      }

      case "subscription.renewed": {
        // Renewed for the next period — keep active, roll the billing window forward.
        await supabaseAdmin
          .from("user_plans")
          .update({
            subscription_status: "active",
            current_period_end: currentPeriodEnd,
            current_period_start: currentPeriodStart,
            past_due_since: null,
          })
          .eq("user_id", userId);
        logger.info({ userId }, "Subscription renewed");
        break;
      }

      case "payment.succeeded": {
        // Payment went through — mark active, clear past_due. Also clears any in-flight
        // plan-change marker: the proration was paid, so there is nothing to roll back.
        await supabaseAdmin
          .from("user_plans")
          .update({
            subscription_status: "active",
            past_due_since: null,
            pending_plan_change_from: null,
            pending_plan_change_at: null,
          })
          .eq("user_id", userId);
        logger.info({ userId }, "Payment successful — subscription active");
        break;
      }

      case "payment.failed":
      case "subscription.on_hold": {
        // A failed payment revokes access immediately — no dunning, no grace period.
        // The user simply re-subscribes from the pricing modal. (Deliberate product
        // decision: a "past due, fix your card within N days" state was judged more
        // confusing than useful for this audience.)
        const { data: existingPlan } = await supabaseAdmin
          .from("user_plans")
          .select("subscription_status, dodo_subscription_id, plan, pending_plan_change_from, pending_plan_change_at")
          .eq("user_id", userId)
          .single();

        // ---- Failed PLAN CHANGE (upgrade or downgrade) ----
        // A plan change raises its own proration invoice. If that invoice is declined the
        // customer still holds a perfectly good, already-paid subscription — only the
        // top-up failed. Cancelling here would destroy what they paid for. So roll the plan
        // back to what it was and leave the subscription running.
        //
        // The 30-minute window keeps this narrow: a proration invoice resolves within
        // seconds, so anything later is a genuine renewal failure and must still cancel.
        const pendingFrom = existingPlan?.pending_plan_change_from as string | null;
        const pendingAt = existingPlan?.pending_plan_change_at as string | null;
        const changeIsRecent =
          !!pendingAt && Date.now() - new Date(pendingAt).getTime() < 30 * 60 * 1000;

        if (pendingFrom && changeIsRecent) {
          await supabaseAdmin
            .from("user_plans")
            .update({
              plan: pendingFrom,
              subscription_status: "active",
              past_due_since: null,
              pending_plan_change_from: null,
              pending_plan_change_at: null,
            })
            .eq("user_id", userId);

          logger.warn(
            { userId, revertedTo: pendingFrom, attemptedPlan: existingPlan?.plan, subscriptionId },
            "Plan-change proration failed — reverted plan, subscription left active. " +
              "Dodo may still hold the attempted plan; reconcile there if the two disagree."
          );
          break;
        }

        // Only an account that actually had a working paid subscription gets expired.
        // A declined card on a FIRST checkout must leave the row untouched: there is no
        // access to revoke and nothing was charged, so the user should just see the
        // pricing modal again. Critically, this also protects a TRIALING user whose
        // upgrade attempt is declined — expiring them would destroy a trial they're
        // still entitled to.
        const prevStatus = existingPlan?.subscription_status;
        if (prevStatus !== "active") {
          logger.info(
            { userId, prevStatus },
            "Payment failed with no active subscription — leaving plan state unchanged"
          );
          break;
        }

        // Kill the subscription at Dodo before revoking locally. Without this it stays
        // billable: Dodo would keep retrying the card and could succeed, charging someone
        // who no longer has access. Since we grant no grace period, the subscription has
        // no remaining purpose.
        // `payment.*` events don't reliably carry subscription_id, so fall back to the id on
        // the row. Without this fallback a payload lacking the id would revoke access while
        // leaving the subscription billable — the exact failure this is meant to prevent.
        // The guard above already verified they match whenever the event does carry one.
        const deadSubscriptionId = subscriptionId || existingPlan?.dodo_subscription_id || "";
        await cancelSubscriptionNow(deadSubscriptionId, "payment failed");

        // Clear the subscription ID along with the status. Two reasons: it's dead, and
        // nulling it makes the stale-subscription guard above drop the `subscription.cancelled`
        // event our own cancellation just triggered — which would otherwise set status to
        // 'cancelled' and hand access straight back until current_period_end.
        await supabaseAdmin
          .from("user_plans")
          .update({
            subscription_status: "expired",
            past_due_since: null,
            dodo_subscription_id: null,
            current_period_end: null,
          })
          .eq("user_id", userId);
        logger.info(
          { userId, subscriptionId: deadSubscriptionId },
          "Payment failed — subscription cancelled and access revoked"
        );
        break;
      }

      case "subscription.plan_changed": {
        // Upgrade/downgrade confirmed by Dodo — update plan + status, keep the existing
        // billing window, and clear the in-flight marker since the change stuck.
        const plan = getPlanFromProduct(productId);
        await supabaseAdmin
          .from("user_plans")
          .update({
            plan,
            subscription_status: mapDodoStatus(status),
            pending_plan_change_from: null,
            pending_plan_change_at: null,
          })
          .eq("user_id", userId);
        logger.info({ userId, plan }, "Subscription plan changed");
        break;
      }

      case "subscription.cancelled": {
        // Cancellation scheduled — user keeps access until current_period_end.
        await supabaseAdmin
          .from("user_plans")
          .update({
            subscription_status: "cancelled",
            current_period_end: currentPeriodEnd,
          })
          .eq("user_id", userId);
        logger.info({ userId }, "Subscription cancelled");
        break;
      }

      case "subscription.expired": {
        await supabaseAdmin
          .from("user_plans")
          .update({ subscription_status: "expired" })
          .eq("user_id", userId);
        logger.info({ userId }, "Subscription expired");
        break;
      }

      // subscription.updated fires on ANY field change (including our own cancel/reactivate
      // toggles), so acting on it would race the dedicated events above. Intentionally a no-op.
      case "subscription.updated":
      case "subscription.update_payment_method":
      case "subscription.failed":
      default:
        logger.info({ eventType }, "Unhandled/no-op webhook event");
    }

    res.status(200).json({ received: true });
  } catch (err: any) {
    logger.error({ err: err.message }, "Webhook processing error");
    // Always return 200 so Dodo doesn't retry a message we've already logged as failed.
    res.status(200).json({ received: true });
  }
});

export default router;
