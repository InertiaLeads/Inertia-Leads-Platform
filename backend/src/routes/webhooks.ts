import { Router, Request, Response } from "express";
import { Webhook } from "standardwebhooks";
import supabaseAdmin from "../services/supabase";
import { getPlanFromProduct, mapDodoStatus } from "../services/dodo";
import logger from "../utils/logger";

const router = Router();

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

    switch (eventType) {
      case "subscription.active": {
        // First activation of a paid subscription. The app owns the trial, so a paid
        // sub always clears trial_ends_at and lands on 'active'.
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
        // Payment went through — mark active, clear past_due.
        await supabaseAdmin
          .from("user_plans")
          .update({ subscription_status: "active", past_due_since: null })
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
          .select("subscription_status")
          .eq("user_id", userId)
          .single();

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

        await supabaseAdmin
          .from("user_plans")
          .update({ subscription_status: "expired", past_due_since: null })
          .eq("user_id", userId);
        logger.info({ userId }, "Payment failed / on hold — access revoked (expired)");
        break;
      }

      case "subscription.plan_changed": {
        // Upgrade/downgrade — update plan + status, keep the existing billing window.
        const plan = getPlanFromProduct(productId);
        await supabaseAdmin
          .from("user_plans")
          .update({ plan, subscription_status: mapDodoStatus(status) })
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
