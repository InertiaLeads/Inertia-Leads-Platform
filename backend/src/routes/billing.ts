import { Router, Request, Response } from "express";
import supabaseAdmin from "../services/supabase";
import { authMiddleware } from "../middleware/auth";
import { getDodoClient, getProductId, describeDodoError, getDodoEnvironment } from "../services/dodo";
import logger from "../utils/logger";

const router = Router();

// POST /api/billing/checkout — Create a checkout session or swap plan for existing subscribers
router.post("/checkout", authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId as string;
    const userEmail = (req as any).userEmail as string;
    const { plan } = req.body;

    const productId = getProductId(plan);
    if (!plan || !productId) {
      return res.status(400).json({ error: "Invalid plan. Must be starter, growth, or agency." });
    }

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    const dodo = getDodoClient();

    // Check if user already has an active subscription
    const { data: userPlan } = await supabaseAdmin
      .from("user_plans")
      .select("dodo_subscription_id, trial_ends_at, subscription_status")
      .eq("user_id", userId)
      .single();

    // past_due is deliberately NOT here. A failed payment now revokes access outright, so
    // such a user must go through a FRESH checkout rather than changePlan — swapping the
    // plan on a subscription whose payment just bounced would fail at Dodo anyway.
    const hasActiveSubscription = userPlan?.dodo_subscription_id &&
      ["active", "trialing"].includes(userPlan?.subscription_status || "");

    // If user has an active subscription, swap the plan in place (no new checkout needed).
    // prorated_immediately = charge/credit the difference now, matching the previous
    // provider's invoiceImmediately behavior for upgrades/downgrades.
    if (hasActiveSubscription) {
      try {
        await dodo.subscriptions.changePlan(userPlan.dodo_subscription_id, {
          product_id: productId,
          proration_billing_mode: "prorated_immediately",
          quantity: 1,
        });
      } catch (changeErr: any) {
        logger.error(
          { dodo: describeDodoError(changeErr), userId, plan, productId },
          "Failed to swap subscription plan"
        );
        return res.status(500).json({ error: "Failed to change plan" });
      }

      // Update local DB immediately (webhook will also confirm)
      await supabaseAdmin
        .from("user_plans")
        .update({ plan, subscription_status: "active", trial_ends_at: null })
        .eq("user_id", userId);

      logger.info({ userId, plan }, "Subscription plan swapped");
      return res.json({ success: true, message: `Plan changed to ${plan}` });
    }

    // No active subscription — create a new checkout.
    // The app owns the free trial (auto-granted at registration, no card), so Dodo must
    // NEVER grant its own trial: trial_period_days: 0 makes any checkout charge the card
    // immediately. user_id is attached as metadata so the webhook can resolve the user.
    let checkoutUrl: string | null | undefined;
    try {
      const session = await dodo.checkoutSessions.create({
        product_cart: [{ product_id: productId, quantity: 1 }],
        customer: { email: userEmail },
        metadata: { user_id: userId },
        subscription_data: { trial_period_days: 0 },
        // Dodo uses this URL for BOTH success and failure, and the checkout runs inside an
        // iframe — so it must point at a PUBLIC page. A page under (dashboard) would fail
        // its server-side auth check (SameSite=Lax cookies aren't sent on cross-site frame
        // navigations) and render /login inside the checkout modal. /billing/return is
        // public and breaks out to the top window, which then loads /settings signed-in.
        return_url: `${frontendUrl}/billing/return`,
        // Charge in USD by default (regardless of the customer's location).
        billing_currency: "USD",
        // Force light mode + English, and hide the discount-code field.
        customization: { theme: "light", force_language: "en" },
        // Hide the discount field; skip Dodo's own receipt page and return to the app
        // immediately after payment (no intermediate "Payment Successful" page).
        feature_flags: { allow_discount_code: false, redirect_immediately: true },
      });
      checkoutUrl = session.checkout_url;
    } catch (checkoutErr: any) {
      // Log the full Dodo response plus the exact inputs. The usual causes are all
      // environment mismatches: a test-mode API key or test-mode product ID being used
      // against live_mode, or live_mode not yet approved for the account at all.
      logger.error(
        { dodo: describeDodoError(checkoutErr), userId, plan, productId, userEmail },
        "Dodo checkout creation failed"
      );
      return res.status(500).json({ error: "Failed to create checkout session" });
    }

    if (!checkoutUrl) {
      return res.status(500).json({ error: "No checkout URL returned" });
    }

    logger.info({ userId, plan }, "Checkout session created");
    res.json({ checkoutUrl });
  } catch (err: any) {
    logger.error(
      { err: err.message, stack: err.stack, dodoEnvironment: getDodoEnvironment() },
      "Checkout error"
    );
    res.status(500).json({ error: "Failed to create checkout" });
  }
});

// POST /api/billing/manage — Get customer portal URL (manage / update payment method)
router.post("/manage", authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId as string;

    // Get user's Dodo customer ID
    const { data: userPlan } = await supabaseAdmin
      .from("user_plans")
      .select("dodo_subscription_id, dodo_customer_id")
      .eq("user_id", userId)
      .single();

    if (!userPlan?.dodo_customer_id) {
      return res.status(404).json({ error: "No active subscription found" });
    }

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    const dodo = getDodoClient();

    // Create a customer portal session (self-service billing management)
    const session = await dodo.customers.customerPortal.create(userPlan.dodo_customer_id, {
      return_url: `${frontendUrl}/settings`,
    });

    const portalUrl = session?.link;
    if (!portalUrl) {
      return res.status(500).json({ error: "Customer portal URL not available" });
    }

    res.json({ portalUrl });
  } catch (err: any) {
    logger.error({ err: err.message }, "Manage subscription error");
    res.status(500).json({ error: "Failed to get subscription portal" });
  }
});

// POST /api/billing/cancel — Cancel subscription (at end of billing period)
router.post("/cancel", authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId as string;
    const { reason } = req.body;

    const { data: userPlan } = await supabaseAdmin
      .from("user_plans")
      .select("dodo_subscription_id")
      .eq("user_id", userId)
      .single();

    if (!userPlan?.dodo_subscription_id) {
      return res.status(404).json({ error: "No active subscription found" });
    }

    const dodo = getDodoClient();
    // Schedule cancellation at period end — user keeps access until current_period_end.
    // Dodo's cancel_reason is a STRICT ENUM (cancelled_by_customer | cancelled_by_merchant |
    // cancelled_by_merchant_send_dunning | dodo_team), NOT free text. Passing the user's
    // dropdown reason (e.g. "Just need a break") makes the API reject the request → 500.
    // So we always send the fixed customer code here; the user's real free-text reason is
    // persisted in our own user_plans.cancel_reason column below (for churn analytics).
    try {
      await dodo.subscriptions.update(userPlan.dodo_subscription_id, {
        cancel_at_next_billing_date: true,
        cancel_reason: "cancelled_by_customer",
      });
    } catch (cancelErr: any) {
      logger.error({ err: cancelErr?.message }, "Failed to cancel subscription");
      return res.status(500).json({ error: "Failed to cancel subscription" });
    }

    // Reflect the scheduled cancellation locally, right here in the endpoint.
    // A cancel-at-period-end emits Dodo's `subscription.updated` event (which we
    // intentionally no-op in the webhook handler to avoid racing our own writes), NOT
    // `subscription.cancelled` — so if we don't set the status here, the UI would stay
    // "Active". We flip it to 'cancelled' now; access still continues until
    // current_period_end (see planLimits.hasActiveSubscription), and Reactivate un-does it.
    await supabaseAdmin
      .from("user_plans")
      .update({
        subscription_status: "cancelled",
        ...(reason ? { cancel_reason: reason } : {}),
      })
      .eq("user_id", userId);

    logger.info({ userId, reason }, "Subscription cancelled");
    res.json({ success: true, message: "Subscription will be cancelled at end of billing period" });
  } catch (err: any) {
    logger.error({ err: err.message }, "Cancel subscription error");
    res.status(500).json({ error: "Failed to cancel subscription" });
  }
});

// POST /api/billing/reactivate — Reactivate a cancelled subscription (before period ends)
router.post("/reactivate", authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId as string;

    const { data: userPlan } = await supabaseAdmin
      .from("user_plans")
      .select("dodo_subscription_id, subscription_status")
      .eq("user_id", userId)
      .single();

    if (!userPlan?.dodo_subscription_id) {
      return res.status(404).json({ error: "No subscription found" });
    }

    if (userPlan.subscription_status !== "cancelled") {
      return res.status(400).json({ error: "Subscription is not in cancelled state" });
    }

    const dodo = getDodoClient();
    // Un-cancel: clear the scheduled cancellation so it renews normally again.
    try {
      await dodo.subscriptions.update(userPlan.dodo_subscription_id, {
        cancel_at_next_billing_date: false,
      });
    } catch (reactivateErr: any) {
      logger.error({ err: reactivateErr?.message }, "Failed to reactivate subscription");
      return res.status(500).json({ error: "Failed to reactivate subscription" });
    }

    // Update local status back to active
    await supabaseAdmin
      .from("user_plans")
      .update({ subscription_status: "active", cancel_reason: null })
      .eq("user_id", userId);

    logger.info({ userId }, "Subscription reactivated");
    res.json({ success: true, message: "Subscription reactivated successfully" });
  } catch (err: any) {
    logger.error({ err: err.message }, "Reactivate subscription error");
    res.status(500).json({ error: "Failed to reactivate subscription" });
  }
});

export default router;
