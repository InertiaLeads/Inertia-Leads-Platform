import { Router } from "express";
import { authMiddleware, AuthenticatedRequest } from "../middleware/auth";
import supabase from "../services/supabase";
import { getPlanInfo, setUserTimezone, ServiceType } from "../services/planLimits";
import { isValidUUID } from "../middleware/validate";

const router = Router();

// GET /api/stats — Dashboard stats for current user
router.get("/", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    // Start of the rolling 7-day window (today and the previous 6 days), UTC midnight.
    const DAY_MS = 24 * 60 * 60 * 1000;
    const weekStart = new Date(today.getTime() - 6 * DAY_MS);

    // Run all stats queries in parallel for speed
    const [
      { count: totalLeads },
      { count: totalCampaigns },
      { count: emailsSent },
      { count: totalEmails },
      { count: repliesReceived },
      { count: emailsFailed },
      { data: scoredLeads },
      { count: callLeads },
      { count: sentToday },
      { data: weekLeadRows },
      { data: weekEmailRows },
    ] = await Promise.all([
      supabase.from("leads").select("*", { count: "exact", head: true }).eq("user_id", req.userId),
      supabase.from("campaigns").select("*", { count: "exact", head: true }).eq("user_id", req.userId),
      supabase.from("emails").select("*", { count: "exact", head: true }).eq("user_id", req.userId).eq("status", "sent"),
      supabase.from("emails").select("*", { count: "exact", head: true }).eq("user_id", req.userId),
      supabase.from("emails").select("*", { count: "exact", head: true }).eq("user_id", req.userId).eq("replied", true),
      supabase.from("emails").select("*", { count: "exact", head: true }).eq("user_id", req.userId).eq("status", "failed"),
      supabase.from("leads").select("score").eq("user_id", req.userId).gt("score", 0),
      supabase.from("leads").select("*", { count: "exact", head: true }).eq("user_id", req.userId).eq("contact_method", "call"),
      supabase.from("emails").select("*", { count: "exact", head: true }).eq("user_id", req.userId).eq("status", "sent").gte("sent_at", today.toISOString()),
      // Last 7 days: leads found (by created_at) and emails sent (by sent_at) for the weekly chart
      supabase.from("leads").select("created_at").eq("user_id", req.userId).gte("created_at", weekStart.toISOString()),
      supabase.from("emails").select("sent_at").eq("user_id", req.userId).eq("status", "sent").gte("sent_at", weekStart.toISOString()),
    ]);

    // Bucket the last 7 days into per-day counts. Index 0 = 6 days ago, index 6 = today.
    const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const weeklyLeads = new Array(7).fill(0);
    const weeklyEmails = new Array(7).fill(0);
    const weeklyLabels: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart.getTime() + i * DAY_MS);
      weeklyLabels.push(i === 6 ? "Today" : WEEKDAYS[d.getUTCDay()]);
    }
    const bucketIndex = (iso: string | null): number => {
      if (!iso) return -1;
      const idx = Math.floor((new Date(iso).getTime() - weekStart.getTime()) / DAY_MS);
      return idx >= 0 && idx < 7 ? idx : -1;
    };
    for (const row of weekLeadRows || []) {
      const i = bucketIndex((row as { created_at: string }).created_at);
      if (i >= 0) weeklyLeads[i]++;
    }
    for (const row of weekEmailRows || []) {
      const i = bucketIndex((row as { sent_at: string }).sent_at);
      if (i >= 0) weeklyEmails[i]++;
    }

    const sent = emailsSent || 0;
    const replies = repliesReceived || 0;
    const replyRate = sent > 0 ? ((replies / sent) * 100).toFixed(1) : "0.0";

    const avgScore =
      scoredLeads && scoredLeads.length > 0
        ? Math.round(scoredLeads.reduce((sum: number, l: any) => sum + (l.score || 0), 0) / scoredLeads.length)
        : 0;

    // Get plan info for this user
    const planInfo = await getPlanInfo(req.userId!);

    res.json({
      totalLeads: totalLeads || 0,
      totalCampaigns: totalCampaigns || 0,
      emailsSent: sent,
      totalEmails: totalEmails || 0,
      emailsFailed: emailsFailed || 0,
      repliesReceived: replies,
      replyRate: `${replyRate}%`,
      avgLeadScore: avgScore,
      callLeads: callLeads || 0,
      sentToday: sentToday || 0,
      weeklyLeads,
      weeklyEmails,
      weeklyLabels,
      dailySendLimit: planInfo.dailyLimit,
      plan: planInfo.plan,
      serviceType: planInfo.serviceType,
      subscriptionStatus: planInfo.subscriptionStatus,
      isOnTrial: planInfo.isOnTrial,
      trialEndsAt: planInfo.trialEndsAt,
      currentPeriodEnd: planInfo.currentPeriodEnd,
      currentPeriodStart: planInfo.currentPeriodStart,
      pastDueSince: planInfo.pastDueSince,
      trialDaysLeft: planInfo.trialDaysLeft,
      features: planInfo.features,
      planLabel: planInfo.planLabel,
      priceMonthly: planInfo.priceMonthly,
      maxDailyEmails: planInfo.maxDailyEmails,
      warmupDay: planInfo.warmupDay,
      warmupComplete: planInfo.warmupComplete,
      warmupPaused: planInfo.warmupPaused,
      warmupWeek: planInfo.warmupWeek,
      leadsFoundThisMonth: planInfo.leadsFoundThisMonth,
      monthlyLeadFindLimit: planInfo.monthlyLeadFindLimit,
      leadsFoundToday: planInfo.leadsFoundToday,
      dailyLeadFindLimit: planInfo.dailyLeadFindLimit,
    });
  } catch {
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// GET /api/stats/campaign/:id — Stats for specific campaign
router.get("/campaign/:id", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { id: campaignId } = req.params;
    if (!isValidUUID(campaignId)) {
      res.status(400).json({ error: "Invalid campaign ID format" });
      return;
    }

    // Fetch campaign
    const { data: campaign, error: campaignError } = await supabase
      .from("campaigns")
      .select("*")
      .eq("id", campaignId)
      .eq("user_id", req.userId)
      .single();

    if (campaignError || !campaign) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }

    // Count leads in campaign
    const { count: totalLeads } = await supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .eq("campaign_id", campaignId);

    // Count high-quality leads (score >= 40)
    const { count: qualityLeads } = await supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .gte("score", 40);

    // Email stats
    const { count: emailsGenerated } = await supabase
      .from("emails")
      .select("*", { count: "exact", head: true })
      .eq("campaign_id", campaignId);

    const { count: emailsSent } = await supabase
      .from("emails")
      .select("*", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("status", "sent");

    const { count: emailsFailed } = await supabase
      .from("emails")
      .select("*", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("status", "failed");

    // Follow-up emails sent (sequence_step > 1)
    const { count: followUpsSent } = await supabase
      .from("emails")
      .select("*", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("status", "sent")
      .gt("sequence_step", 1);

    // Calculate metrics
    const emailRate =
      totalLeads && totalLeads > 0
        ? Math.round((emailsGenerated || 0) / totalLeads * 100)
        : 0;

    // Replies for this campaign
    const { count: repliesReceived } = await supabase
      .from("emails")
      .select("*", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("replied", true);

    const sent = emailsSent || 0;
    const replies = repliesReceived || 0;
    const replyRate = sent > 0 ? ((replies / sent) * 100).toFixed(1) : "0.0";

    res.json({
      name: campaign.name,
      status: campaign.status,
      totalLeads: totalLeads || 0,
      qualityLeads: qualityLeads || 0,
      emailsGenerated: emailsGenerated || 0,
      emailsSent: sent,
      emailsFailed: emailsFailed || 0,
      followUpsSent: followUpsSent || 0,
      repliesReceived: replies,
      replyRate: `${replyRate}%`,
      emailRate: `${emailRate}%`,
      enableFollowups: campaign.enable_followups,
    });
  } catch {
    res.status(500).json({ error: "Failed to fetch campaign stats" });
  }
});

// PUT /api/stats/timezone — Set user's timezone (auto-detected from browser)
router.put("/timezone", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { timezone } = req.body;
    if (!timezone || typeof timezone !== "string") {
      res.status(400).json({ error: "Timezone is required" });
      return;
    }

    const ok = await setUserTimezone(req.userId!, timezone);
    if (!ok) {
      res.status(400).json({ error: "Invalid timezone" });
      return;
    }

    res.json({ success: true, timezone });
  } catch {
    res.status(500).json({ error: "Failed to set timezone" });
  }
});

// PUT /api/stats/service-type — Set user's service type for AI email generation
const VALID_SERVICE_TYPES: ServiceType[] = ["web_dev", "seo", "digital_marketing", "social_media"];
// social_media is accepted for backward compat but treated as digital_marketing
router.put("/service-type", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { serviceType } = req.body;
    if (!serviceType || !VALID_SERVICE_TYPES.includes(serviceType)) {
      res.status(400).json({ error: "Invalid service type. Must be one of: web_dev, seo, digital_marketing, social_media" });
      return;
    }

    const { error } = await supabase
      .from("user_plans")
      .update({ service_type: serviceType, updated_at: new Date().toISOString() })
      .eq("user_id", req.userId);

    if (error) {
      res.status(500).json({ error: "Failed to update service type" });
      return;
    }

    res.json({ success: true, serviceType });
  } catch {
    res.status(500).json({ error: "Failed to update service type" });
  }
});

export default router;
