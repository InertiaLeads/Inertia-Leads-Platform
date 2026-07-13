import { Router, Request, Response } from "express";
import { lemonSqueezySetup, createCheckout, getSubscription, cancelSubscription, updateSubscription } from "@lemonsqueezy/lemonsqueezy.js";
import supabaseAdmin from "../services/supabase";
import { authMiddleware } from "../middleware/auth";
import logger from "../utils/logger";

const router = Router();

// Variant IDs map to plans
const VARIANT_MAP: Record<string, string> = {
  starter: process.env.LEMONSQUEEZY_STARTER_VARIANT_ID || "",
  growth: process.env.LEMONSQUEEZY_GROWTH_VARIANT_ID || "",
  agency: process.env.LEMONSQUEEZY_AGENCY_VARIANT_ID || "",
};

function initLemonSqueezy() {
  const apiKey = process.env.LEMONSQUEEZY_API_KEY;
  if (!apiKey) throw new Error("LEMONSQUEEZY_API_KEY not configured");
  lemonSqueezySetup({ apiKey });
}

// POST /api/billing/checkout — Create a checkout session or swap plan for existing subscribers
router.post("/checkout", authMiddleware, async (req: Request, res: Response) => {
  try {
    initLemonSqueezy();

    const userId = (req as any).userId as string;
    const userEmail = (req as any).userEmail as string;
    const { plan } = req.body;

    if (!plan || !VARIANT_MAP[plan]) {
      return res.status(400).json({ error: "Invalid plan. Must be starter, growth, or agency." });
    }

    const storeId = process.env.LEMONSQUEEZY_STORE_ID;
    if (!storeId) {
      return res.status(500).json({ error: "Payment system not configured" });
    }

    const variantId = VARIANT_MAP[plan];
    if (!variantId) {
      return res.status(500).json({ error: `Variant ID not configured for ${plan} plan` });
    }

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";

    // Check if user already has an active subscription
    const { data: userPlan } = await supabaseAdmin
      .from("user_plans")
      .select("lemon_squeezy_subscription_id, trial_ends_at, subscription_status")
      .eq("user_id", userId)
      .single();

    const hasActiveSubscription = userPlan?.lemon_squeezy_subscription_id &&
      ["active", "trialing", "past_due"].includes(userPlan?.subscription_status || "");

    // If user has an active subscription, swap the plan (no new checkout needed)
    if (hasActiveSubscription) {
      const { error: updateError } = await updateSubscription(
        userPlan.lemon_squeezy_subscription_id,
        { variantId: parseInt(variantId) }
      );

      if (updateError) {
        logger.error({ updateError }, "Failed to swap subscription plan");
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
    // The app owns the free trial (auto-granted at registration, no card), so Lemon Squeezy must
    // NEVER grant its own trial: any checkout charges the card immediately. This applies whether the
    // user is still mid-trial (upgrading early) or their trial has already expired.
    const { data, error } = await createCheckout(storeId, variantId, {
      checkoutData: {
        email: userEmail,
        custom: {
          user_id: userId,
        },
      },
      checkoutOptions: {
        buttonColor: "#6962c4",
        skipTrial: true,
      },
      productOptions: {
        redirectUrl: `${frontendUrl}/settings`,
        receiptButtonText: "Continue",
        receiptLinkUrl: `${frontendUrl}/settings?payment=success`,
      },
      testMode: process.env.NODE_ENV !== "production",
    });

    if (error) {
      logger.error({ error }, "Lemon Squeezy checkout creation failed");
      return res.status(500).json({ error: "Failed to create checkout session" });
    }

    const checkoutUrl = data?.data?.attributes?.url;
    if (!checkoutUrl) {
      return res.status(500).json({ error: "No checkout URL returned" });
    }

    logger.info({ userId, plan }, "Checkout session created");
    res.json({ checkoutUrl });
  } catch (err: any) {
    logger.error({ err: err.message, stack: err.stack }, "Checkout error");
    res.status(500).json({ error: "Failed to create checkout" });
  }
});

// POST /api/billing/manage — Get customer portal URL
router.post("/manage", authMiddleware, async (req: Request, res: Response) => {
  try {
    initLemonSqueezy();

    const userId = (req as any).userId as string;

    // Get user's subscription ID
    const { data: userPlan } = await supabaseAdmin
      .from("user_plans")
      .select("lemon_squeezy_subscription_id, lemon_squeezy_customer_id")
      .eq("user_id", userId)
      .single();

    if (!userPlan?.lemon_squeezy_subscription_id) {
      return res.status(404).json({ error: "No active subscription found" });
    }

    // Get subscription to find customer portal URL
    const { data, error } = await getSubscription(userPlan.lemon_squeezy_subscription_id);

    if (error) {
      logger.error({ error }, "Failed to get subscription");
      return res.status(500).json({ error: "Failed to get subscription details" });
    }

    const urls = data?.data?.attributes?.urls;
    const portalUrl = urls?.customer_portal;

    if (!portalUrl) {
      return res.status(500).json({ error: "Customer portal URL not available" });
    }

    res.json({ portalUrl });
  } catch (err: any) {
    logger.error({ err: err.message }, "Manage subscription error");
    res.status(500).json({ error: "Failed to get subscription portal" });
  }
});

// POST /api/billing/cancel — Cancel subscription
router.post("/cancel", authMiddleware, async (req: Request, res: Response) => {
  try {
    initLemonSqueezy();

    const userId = (req as any).userId as string;
    const { reason } = req.body;

    const { data: userPlan } = await supabaseAdmin
      .from("user_plans")
      .select("lemon_squeezy_subscription_id")
      .eq("user_id", userId)
      .single();

    if (!userPlan?.lemon_squeezy_subscription_id) {
      return res.status(404).json({ error: "No active subscription found" });
    }

    const { error } = await cancelSubscription(userPlan.lemon_squeezy_subscription_id);

    if (error) {
      logger.error({ error }, "Failed to cancel subscription");
      return res.status(500).json({ error: "Failed to cancel subscription" });
    }

    // Store cancellation reason
    if (reason) {
      await supabaseAdmin
        .from("user_plans")
        .update({ cancel_reason: reason })
        .eq("user_id", userId);
    }

    logger.info({ userId, reason }, "Subscription cancelled");
    res.json({ success: true, message: "Subscription will be cancelled at end of billing period" });
  } catch (err: any) {
    logger.error({ err: err.message }, "Cancel subscription error");
    res.status(500).json({ error: "Failed to cancel subscription" });
  }
});

// Reactivate a cancelled subscription (before period ends)
router.post("/reactivate", authMiddleware, async (req: Request, res: Response) => {
  try {
    initLemonSqueezy();

    const userId = (req as any).userId as string;

    const { data: userPlan } = await supabaseAdmin
      .from("user_plans")
      .select("lemon_squeezy_subscription_id, subscription_status")
      .eq("user_id", userId)
      .single();

    if (!userPlan?.lemon_squeezy_subscription_id) {
      return res.status(404).json({ error: "No subscription found" });
    }

    if (userPlan.subscription_status !== "cancelled") {
      return res.status(400).json({ error: "Subscription is not in cancelled state" });
    }

    // Un-cancel by setting cancelled to false
    const { error } = await updateSubscription(userPlan.lemon_squeezy_subscription_id, {
      cancelled: false,
    });

    if (error) {
      logger.error({ error }, "Failed to reactivate subscription");
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
