import supabase from "./supabase";

// =============================================
// Plan Definitions — Option C (single inbox)
// =============================================
// Warmup ramps up over 3 weeks, then stays at steady-state cap.
// Warmup tracks per Gmail inbox (gmail_connected_at), NOT per billing cycle.

export type PlanTier = "starter" | "growth" | "agency";
export type SubscriptionStatus = "none" | "trialing" | "active" | "cancelled" | "past_due" | "paused" | "expired";

interface PlanConfig {
  // Warmup schedule: daily send limits per week
  warmup: [number, number, number]; // [week1, week2, week3]
  // Steady-state max emails/day after warmup completes (week 4+)
  maxDailyEmails: number;
  // Monthly auto-find lead limit
  monthlyLeadFindLimit: number;
  // Max AI generations per day (initial + follow-ups = 3x daily emails)
  maxDailyGenerations: number;
  // Max leads per single enrich request
  maxEnrichBatchSize: number;
  // Price (for display only — billing handled separately)
  priceMonthly: number;
}

export const PLAN_CONFIGS: Record<PlanTier, PlanConfig> = {
  starter: {
    warmup: [10, 20, 35],
    maxDailyEmails: 50,
    monthlyLeadFindLimit: 1100,
    maxDailyGenerations: 150,   // 50 leads × 3 emails each
    maxEnrichBatchSize: 50,
    priceMonthly: 39,
  },
  growth: {
    warmup: [20, 45, 90],
    maxDailyEmails: 100,
    monthlyLeadFindLimit: 2200,
    maxDailyGenerations: 300,   // 100 leads × 3 emails each
    maxEnrichBatchSize: 100,
    priceMonthly: 79,
  },
  agency: {
    warmup: [40, 100, 200],
    maxDailyEmails: 200,
    monthlyLeadFindLimit: 4400,
    maxDailyGenerations: 600,   // 200 leads × 3 emails each
    maxEnrichBatchSize: 200,
    priceMonthly: 129,
  },
};

// =============================================
// Trial Limits — uniform for all plans during trial
// =============================================
const TRIAL_DAILY_EMAILS = 20;      // emails sent/day during trial
const TRIAL_DAILY_LEADS = 20;       // leads/day (auto-find + CSV share this bucket)
const TRIAL_DAILY_GENERATIONS = 60; // 20 leads × 3 emails (initial + 2 follow-ups)
const TRIAL_ENRICH_BATCH = 20;      // max leads per single enrich request
const TRIAL_MONTHLY_LEADS = 140;    // 20/day × 7 days

// Number of free-trial days granted automatically on registration (no card required)
const TRIAL_DURATION_DAYS = 7;
// Plan whose features the free trial unlocks
const TRIAL_PLAN: PlanTier = "growth";

// =============================================
// Feature Gating — which features each plan unlocks
// During trial: ALL features are accessible
// After payment: features gated by plan
// =============================================
export interface FeatureAccess {
  hotLeadTracking: boolean;
  csvUpload: boolean;
  auditReports: boolean;
  prioritySupport: boolean;
  autoFindLeads: boolean;
  leadScoring: boolean;
  emailPersonalization: boolean;
  gmailWarmup: boolean;
}

export function getFeatureAccess(plan: PlanTier, isOnTrial: boolean): FeatureAccess {
  // During trial: everything unlocked
  if (isOnTrial) {
    return {
      hotLeadTracking: true,
      csvUpload: true,
      auditReports: true,
      prioritySupport: true,
      autoFindLeads: true,
      leadScoring: true,
      emailPersonalization: true,
      gmailWarmup: true,
    };
  }

  // After trial: gated by plan
  switch (plan) {
    case "starter":
      return {
        hotLeadTracking: false,
        csvUpload: false,
        auditReports: false,
        prioritySupport: false,
        autoFindLeads: true,
        leadScoring: true,
        emailPersonalization: true,
        gmailWarmup: true,
      };
    case "growth":
      return {
        hotLeadTracking: true,
        csvUpload: true,
        auditReports: true,
        prioritySupport: false,
        autoFindLeads: true,
        leadScoring: true,
        emailPersonalization: true,
        gmailWarmup: true,
      };
    case "agency":
      return {
        hotLeadTracking: true,
        csvUpload: true,
        auditReports: true,
        prioritySupport: true,
        autoFindLeads: true,
        leadScoring: true,
        emailPersonalization: true,
        gmailWarmup: true,
      };
  }
}

// Check if user is currently on trial (status is trialing AND trial hasn't expired)
export function isTrialing(subscriptionStatus: SubscriptionStatus, trialEndsAt: string | null): boolean {
  if (subscriptionStatus !== "trialing") return false;
  if (!trialEndsAt) return false;
  return new Date(trialEndsAt) > new Date();
}

// Check if trial has expired without payment
export function isTrialExpired(subscriptionStatus: SubscriptionStatus, trialEndsAt: string | null): boolean {
  if (subscriptionStatus !== "trialing") return false;
  if (!trialEndsAt) return true;
  return new Date(trialEndsAt) <= new Date();
}

// =============================================
// Subscription Access Check — MUST pass before any feature operation
// Returns whether the user has an active subscription that grants access.
// This is the SERVER-SIDE gate — frontend checks are cosmetic only.
// =============================================
export function hasActiveSubscription(
  subscriptionStatus: SubscriptionStatus,
  trialEndsAt: string | null,
  currentPeriodEnd: string | null,
  pastDueSince: string | null
): boolean {
  switch (subscriptionStatus) {
    case "active":
      return true;

    case "trialing":
      // Must have valid, non-expired trial
      if (!!trialEndsAt && new Date(trialEndsAt) > new Date()) return true;
      // Edge case: status stuck at "trialing" with no trial end date but valid paid period
      // This happens when a paying user's status wasn't updated from trialing → active
      if (!trialEndsAt && !!currentPeriodEnd && new Date(currentPeriodEnd) > new Date()) return true;
      return false;

    case "past_due":
      // 3-day grace period from when payment first failed
      if (!pastDueSince) return true; // If no timestamp recorded, give benefit of doubt
      const gracePeriodMs = 3 * 24 * 60 * 60 * 1000; // 3 days
      return (Date.now() - new Date(pastDueSince).getTime()) < gracePeriodMs;

    case "cancelled":
      // Access continues until end of paid period
      return !!currentPeriodEnd && new Date(currentPeriodEnd) > new Date();

    case "paused":
    case "expired":
    case "none":
    default:
      return false;
  }
}

// Convenience wrapper that takes a getUserPlan result
export async function checkSubscriptionAccess(userId: string): Promise<{
  hasAccess: boolean;
  reason: string;
  status: SubscriptionStatus;
}> {
  const userPlan = await getUserPlan(userId);
  const hasAccess = hasActiveSubscription(
    userPlan.subscriptionStatus,
    userPlan.trialEndsAt,
    userPlan.currentPeriodEnd,
    userPlan.pastDueSince
  );

  let reason = "";
  if (!hasAccess) {
    switch (userPlan.subscriptionStatus) {
      case "none": reason = "No active subscription. Please select a plan."; break;
      case "trialing": reason = "Your trial has expired. Please subscribe to continue."; break;
      case "expired": reason = "Your subscription has expired. Please renew."; break;
      case "cancelled": reason = "Your subscription period has ended. Please renew."; break;
      case "paused": reason = "Your subscription is paused. Please resume to continue."; break;
      case "past_due": reason = "Payment failed. Please update your payment method."; break;
      default: reason = "Subscription inactive.";
    }
  }

  return { hasAccess, reason, status: userPlan.subscriptionStatus };
}

// Default plan for new users
const DEFAULT_PLAN: PlanTier = "starter";

// =============================================
// Timezone helpers
// =============================================
function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Get the start of today (midnight) in the user's timezone, returned as a UTC Date.
// E.g. for Asia/Kolkata: if it's 9:30 AM IST Apr 17, returns Apr 16 6:30 PM UTC (= midnight IST Apr 17).
function getStartOfTodayInTz(tz: string): Date {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) => parseInt(parts.find((p) => p.type === type)!.value);
  let hour = get("hour");
  if (hour === 24) hour = 0;

  // Compute the timezone offset: localAsUtc - realUtc = offset
  // Round to nearest MINUTE — all real-world timezone offsets are whole minutes
  // (e.g. IST +5:30, Nepal +5:45). This eliminates ms/second drift from now.getTime().
  const localAsUtcMs = Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
  const offsetMinutes = Math.round((localAsUtcMs - now.getTime()) / 60000);
  const cleanOffsetMs = offsetMinutes * 60000;
  const localMidnightMs = Date.UTC(get("year"), get("month") - 1, get("day"), 0, 0, 0);
  return new Date(localMidnightMs - cleanOffsetMs);
}

// Check if a daily counter has expired — true if reset_at is before today's midnight
// in the user's timezone. Timezone change is locked to once per 24h to prevent exploits.
function isDailyCounterExpired(resetAt: string | null, tz: string): boolean {
  if (!resetAt) return true;
  const todayMidnight = getStartOfTodayInTz(tz);
  return new Date(resetAt) < todayMidnight;
}

// =============================================
// Get or create user plan
// =============================================
export type ServiceType = "web_dev" | "seo" | "digital_marketing" | "social_media";
// NOTE: social_media is deprecated — treated as digital_marketing. Kept for backward compat.

export async function getUserPlan(userId: string): Promise<{
  plan: PlanTier;
  serviceType: ServiceType;
  subscriptionStatus: SubscriptionStatus;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  currentPeriodStart: string | null;
  pastDueSince: string | null;
  isOnTrial: boolean;
  gmailConnectedAt: string | null;
  isActive: boolean;
  leadsFoundThisMonth: number;
  leadsFoundResetAt: string;
  leadsFoundToday: number;
  leadsFoundTodayResetAt: string;
  emailsGeneratedToday: number;
  emailsGeneratedTodayResetAt: string;
  emailsSentToday: number;
  emailsSentTodayResetAt: string;
  timezone: string;
}> {
  const { data, error } = await supabase
    .from("user_plans")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (error || !data) {
    // Brand-new user: auto-start a 7-day free trial on the Growth plan (no card required).
    // The trial clock starts on the user's first authenticated API call, which happens right
    // after they verify email and land on /settings.
    const trialEndsIso = new Date(Date.now() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000).toISOString();

    // Try INSERT-only (ignoreDuplicates: true = ON CONFLICT DO NOTHING).
    // This creates a row for genuinely new users but NEVER overwrites existing data.
    await supabase
      .from("user_plans")
      .upsert({
        user_id: userId,
        plan: TRIAL_PLAN,
        subscription_status: "trialing",
        trial_ends_at: trialEndsIso,
        is_active: true,
        leads_found_this_month: 0,
        leads_found_reset_at: new Date().toISOString(),
        leads_found_today: 0,
        leads_found_today_reset_at: new Date().toISOString(),
        emails_generated_today: 0,
        emails_generated_today_reset_at: new Date().toISOString(),
        emails_sent_today: 0,
        emails_sent_today_reset_at: new Date().toISOString(),
        timezone: "UTC",
      }, { onConflict: "user_id", ignoreDuplicates: true });

    // Now re-SELECT — whether we just inserted or the row already existed
    const { data: plan2, error: err2 } = await supabase
      .from("user_plans")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (err2 || !plan2) {
      // Genuinely unreachable unless DB is down — return safe read-only defaults
      // (these are NOT written to the DB, so no counter reset)
      return {
        plan: DEFAULT_PLAN,
        serviceType: "web_dev" as ServiceType,
        subscriptionStatus: "none" as SubscriptionStatus,
        trialEndsAt: null,
        currentPeriodEnd: null,
        currentPeriodStart: null,
        pastDueSince: null,
        isOnTrial: false,
        gmailConnectedAt: null,
        isActive: true,
        leadsFoundThisMonth: 0,
        leadsFoundResetAt: new Date().toISOString(),
        leadsFoundToday: 0,
        leadsFoundTodayResetAt: new Date().toISOString(),
        emailsGeneratedToday: 0,
        emailsGeneratedTodayResetAt: new Date().toISOString(),
        emailsSentToday: 0,
        emailsSentTodayResetAt: new Date().toISOString(),
        timezone: "UTC",
      };
    }

    // Use the REAL data from the DB (preserves existing counters)
    const tz = plan2.timezone || "UTC";
    const subStatus = (plan2.subscription_status || "none") as SubscriptionStatus;
    const trialEnds = plan2.trial_ends_at || null;
    return {
      plan: plan2.plan as PlanTier,
      serviceType: (plan2.service_type || "web_dev") as ServiceType,
      subscriptionStatus: subStatus,
      trialEndsAt: trialEnds,
      currentPeriodEnd: plan2.current_period_end || null,
      currentPeriodStart: plan2.current_period_start || null,
      pastDueSince: plan2.past_due_since || null,
      isOnTrial: isTrialing(subStatus, trialEnds),
      gmailConnectedAt: plan2.gmail_connected_at,
      isActive: plan2.is_active,
      leadsFoundThisMonth: plan2.leads_found_this_month || 0,
      leadsFoundResetAt: plan2.leads_found_reset_at,
      leadsFoundToday: isDailyCounterExpired(plan2.leads_found_today_reset_at, tz)
        ? 0 : (plan2.leads_found_today || 0),
      leadsFoundTodayResetAt: plan2.leads_found_today_reset_at || new Date().toISOString(),
      emailsGeneratedToday: isDailyCounterExpired(plan2.emails_generated_today_reset_at, tz)
        ? 0 : (plan2.emails_generated_today || 0),
      emailsGeneratedTodayResetAt: plan2.emails_generated_today_reset_at || new Date().toISOString(),
      emailsSentToday: isDailyCounterExpired(plan2.emails_sent_today_reset_at, tz)
        ? 0 : (plan2.emails_sent_today || 0),
      emailsSentTodayResetAt: plan2.emails_sent_today_reset_at || new Date().toISOString(),
      timezone: tz,
    };
  }

  // Daily counter expiry — resets at midnight in the user's timezone.
  // Timezone change is locked to once per 24h to prevent exploit.
  const userTz = data.timezone || "UTC";

  const effectiveLeadsFoundToday = isDailyCounterExpired(data.leads_found_today_reset_at, userTz)
    ? 0 : (data.leads_found_today || 0);

  const effectiveEmailsGeneratedToday = isDailyCounterExpired(data.emails_generated_today_reset_at, userTz)
    ? 0 : (data.emails_generated_today || 0);

  const effectiveEmailsSentToday = isDailyCounterExpired(data.emails_sent_today_reset_at, userTz)
    ? 0 : (data.emails_sent_today || 0);

  const subStatus = (data.subscription_status || "none") as SubscriptionStatus;
  const trialEnds = data.trial_ends_at || null;

  return {
    plan: data.plan as PlanTier,
    serviceType: (data.service_type || "web_dev") as ServiceType,
    subscriptionStatus: subStatus,
    trialEndsAt: trialEnds,
    currentPeriodEnd: data.current_period_end || null,
    currentPeriodStart: data.current_period_start || null,
    pastDueSince: data.past_due_since || null,
    isOnTrial: isTrialing(subStatus, trialEnds),
    gmailConnectedAt: data.gmail_connected_at,
    isActive: data.is_active,
    leadsFoundThisMonth: data.leads_found_this_month || 0,
    leadsFoundResetAt: data.leads_found_reset_at,
    leadsFoundToday: effectiveLeadsFoundToday,
    leadsFoundTodayResetAt: data.leads_found_today_reset_at || new Date().toISOString(),
    emailsGeneratedToday: effectiveEmailsGeneratedToday,
    emailsGeneratedTodayResetAt: data.emails_generated_today_reset_at || new Date().toISOString(),
    emailsSentToday: effectiveEmailsSentToday,
    emailsSentTodayResetAt: data.emails_sent_today_reset_at || new Date().toISOString(),
    timezone: data.timezone || "UTC",
  };
}

// =============================================
// Calculate warmup day (based on actual sending activity)
// Counts distinct days the user has sent at least 1 email.
// Also detects if warmup is "paused" (no sends in last 48h).
// =============================================
async function getWarmupInfo(userId: string, gmailConnectedAt: string | null): Promise<{
  warmupDay: number;
  warmupPaused: boolean;
  lastSentAt: string | null;
}> {
  if (!gmailConnectedAt) return { warmupDay: 0, warmupPaused: false, lastSentAt: null };

  // Count distinct days user has sent at least 1 email
  const { data: sentDays, error } = await supabase
    .from("emails")
    .select("sent_at")
    .eq("user_id", userId)
    .eq("status", "sent")
    .not("sent_at", "is", null)
    .order("sent_at", { ascending: true });

  if (error || !sentDays || sentDays.length === 0) {
    // Gmail connected but never sent — day 0, paused
    return { warmupDay: 0, warmupPaused: true, lastSentAt: null };
  }

  // Count unique calendar days (UTC)
  const uniqueDays = new Set<string>();
  let lastSentAt: string | null = null;
  for (const row of sentDays) {
    if (row.sent_at) {
      const day = row.sent_at.substring(0, 10); // "YYYY-MM-DD"
      uniqueDays.add(day);
      lastSentAt = row.sent_at;
    }
  }

  const warmupDay = uniqueDays.size;

  // Paused = no email sent in the last 48 hours
  let warmupPaused = true;
  if (lastSentAt) {
    const lastSent = new Date(lastSentAt);
    const hoursSinceLastSend = (Date.now() - lastSent.getTime()) / (1000 * 60 * 60);
    warmupPaused = hoursSinceLastSend > 48;
  }

  return { warmupDay, warmupPaused, lastSentAt };
}

// =============================================
// Get today's daily email limit for a user
// =============================================
export async function getDailyLimit(userId: string): Promise<{
  limit: number;
  plan: PlanTier;
  warmupDay: number;
  warmupComplete: boolean;
  warmupPaused: boolean;
  maxCap: number;
}> {
  const userPlan = await getUserPlan(userId);
  const config = PLAN_CONFIGS[userPlan.plan];

  // SECURITY: Check subscription access first
  const hasAccess = hasActiveSubscription(
    userPlan.subscriptionStatus,
    userPlan.trialEndsAt,
    userPlan.currentPeriodEnd,
    userPlan.pastDueSince
  );
  if (!hasAccess) {
    return { limit: 0, plan: userPlan.plan, warmupDay: 0, warmupComplete: false, warmupPaused: false, maxCap: 0 };
  }

  const { warmupDay, warmupPaused } = await getWarmupInfo(userId, userPlan.gmailConnectedAt);

  // Gmail not connected — no sending allowed
  if (!userPlan.gmailConnectedAt) {
    return {
      limit: 0,
      plan: userPlan.plan,
      warmupDay: 0,
      warmupComplete: false,
      warmupPaused: false,
      maxCap: userPlan.isOnTrial ? TRIAL_DAILY_EMAILS : config.maxDailyEmails,
    };
  }

  // Never sent any email — allow week 1 limit so they can start
  if (warmupDay === 0) {
    return {
      limit: config.warmup[0],
      plan: userPlan.plan,
      warmupDay: 0,
      warmupComplete: false,
      warmupPaused: true,
      maxCap: config.maxDailyEmails,
    };
  }

  let limit: number;
  let warmupComplete = false;

  if (warmupDay <= 7) {
    // Week 1
    limit = config.warmup[0];
  } else if (warmupDay <= 14) {
    // Week 2
    limit = config.warmup[1];
  } else if (warmupDay <= 21) {
    // Week 3
    limit = config.warmup[2];
  } else {
    // Week 4+ — steady state
    limit = config.maxDailyEmails;
    warmupComplete = true;
  }

  // During trial: cap sending at trial limit (warmup still applies if lower)
  const effectiveMaxCap = userPlan.isOnTrial ? TRIAL_DAILY_EMAILS : config.maxDailyEmails;
  limit = Math.min(limit, effectiveMaxCap);

  return {
    limit,
    plan: userPlan.plan,
    warmupDay,
    warmupComplete,
    warmupPaused,
    maxCap: effectiveMaxCap,
  };
}

// =============================================
// Get daily lead find limit
// Matches the plan's max daily email cap so user always
// has exactly enough leads to fill one day of sending.
// Starter: 50/day, Growth: 100/day, Agency: 200/day
// =============================================
export async function getDailyLeadFindLimit(userId: string): Promise<number> {
  const userPlan = await getUserPlan(userId);
  if (userPlan.isOnTrial) return TRIAL_DAILY_LEADS;
  const config = PLAN_CONFIGS[userPlan.plan];
  return config.maxDailyEmails; // 50 / 100 / 200
}

// =============================================
// Count how many leads the user has found TODAY
// Delegates to getUserPlan which handles timezone-aware daily reset.
// =============================================
export async function getLeadsFoundToday(userId: string): Promise<number> {
  const userPlan = await getUserPlan(userId);
  return userPlan.leadsFoundToday;
}

// =============================================
// Atomically increment daily lead find counter
// The RPC handles auto-reset on new day + increment
// in a single atomic UPDATE (no race conditions).
// This counter NEVER decrements — deleted leads
// still count against the daily limit.
// =============================================
export async function incrementLeadsFoundToday(userId: string, count: number): Promise<void> {
  await supabase.rpc("increment_leads_found_today", {
    p_user_id: userId,
    p_count: count,
  });
}

// =============================================
// Decrement daily lead counter when background scraper
// deletes useless leads (no email + no phone).
// This gives the user back those slots so CSV/auto-find
// remaining count stays accurate.
// =============================================
export async function decrementLeadsFoundToday(userId: string, count: number): Promise<void> {
  if (count <= 0) return;
  const { data } = await supabase
    .from("user_plans")
    .select("leads_found_today, leads_found_this_month")
    .eq("user_id", userId)
    .single();
  if (!data) return;
  await supabase
    .from("user_plans")
    .update({
      leads_found_today: Math.max(0, (data.leads_found_today || 0) - count),
      leads_found_this_month: Math.max(0, (data.leads_found_this_month || 0) - count),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
}

// =============================================
// Check if user can find more leads today (daily cap)
// Returns: allowed, remaining slots, used today, daily limit
// =============================================
export async function checkDailyLeadFindLimit(userId: string): Promise<{
  allowed: boolean;
  remaining: number;
  usedToday: number;
  dailyLimit: number;
  plan: PlanTier;
}> {
  const userPlan = await getUserPlan(userId);

  // SECURITY: Check subscription access first
  const hasAccess = hasActiveSubscription(
    userPlan.subscriptionStatus,
    userPlan.trialEndsAt,
    userPlan.currentPeriodEnd,
    userPlan.pastDueSince
  );
  if (!hasAccess) {
    return { allowed: false, remaining: 0, usedToday: 0, dailyLimit: 0, plan: userPlan.plan };
  }

  // Self-heal: if status is stuck as "trialing" but trial_ends_at is null with a valid period end,
  // silently correct it to "active" so the UI and all future checks are consistent
  if (userPlan.subscriptionStatus === "trialing" && !userPlan.trialEndsAt && userPlan.currentPeriodEnd) {
    supabase.from("user_plans").update({ subscription_status: "active", trial_ends_at: null }).eq("user_id", userId).then(() => {
      console.log(`[checkDailyLeadFindLimit] Auto-healed status for user ${userId}: trialing → active`);
    });
  }

  const config = PLAN_CONFIGS[userPlan.plan];
  const dailyLimit = userPlan.isOnTrial ? TRIAL_DAILY_LEADS : config.maxDailyEmails;
  const usedToday = userPlan.leadsFoundToday;
  const remaining = Math.max(0, dailyLimit - usedToday);

  return {
    allowed: remaining > 0,
    remaining,
    usedToday,
    dailyLimit,
    plan: userPlan.plan,
  };
}

// =============================================
// Check if user can find more leads this month
// =============================================
export async function checkLeadFindLimit(userId: string): Promise<{
  allowed: boolean;
  used: number;
  limit: number;
  plan: PlanTier;
}> {
  const userPlan = await getUserPlan(userId);

  // SECURITY: Check subscription access first
  const hasAccess = hasActiveSubscription(
    userPlan.subscriptionStatus,
    userPlan.trialEndsAt,
    userPlan.currentPeriodEnd,
    userPlan.pastDueSince
  );
  if (!hasAccess) {
    return { allowed: false, used: 0, limit: 0, plan: userPlan.plan };
  }

  const config = PLAN_CONFIGS[userPlan.plan];
  const monthlyLimit = userPlan.isOnTrial ? TRIAL_MONTHLY_LEADS : config.monthlyLeadFindLimit;

  // Check if we need to reset the monthly counter (30 days from last reset)
  const resetAt = new Date(userPlan.leadsFoundResetAt);
  const now = new Date();
  const daysSinceReset = (now.getTime() - resetAt.getTime()) / (1000 * 60 * 60 * 24);

  if (daysSinceReset >= 30) {
    // Reset monthly counter
    await supabase
      .from("user_plans")
      .update({
        leads_found_this_month: 0,
        leads_found_reset_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq("user_id", userId);

    return {
      allowed: true,
      used: 0,
      limit: monthlyLimit,
      plan: userPlan.plan,
    };
  }

  return {
    allowed: userPlan.leadsFoundThisMonth < monthlyLimit,
    used: userPlan.leadsFoundThisMonth,
    limit: monthlyLimit,
    plan: userPlan.plan,
  };
}

// =============================================
// Increment leads found counter
// =============================================
export async function incrementLeadsFound(userId: string, count: number): Promise<void> {
  await supabase.rpc("increment_leads_found", {
    p_user_id: userId,
    p_count: count,
  });
}

// =============================================
// Max Gmail inboxes per plan (inbox rotation)
// =============================================
export function getMaxInboxes(plan: PlanTier): number {
  switch (plan) {
    case "starter": return 1;
    case "growth": return 2;
    case "agency": return 4;
    default: return 1;
  }
}

// Gmail safety cap per inbox/day (buffer below Google's 500 hard limit)
export const GMAIL_INBOX_CAP = 450;

// =============================================
// Set Gmail connected timestamp (starts warmup)
// =============================================
export async function setGmailConnectedAt(userId: string): Promise<void> {
  const userPlan = await getUserPlan(userId);

  // Only set if not already set (don't reset warmup on re-auth)
  if (!userPlan.gmailConnectedAt) {
    await supabase
      .from("user_plans")
      .update({
        gmail_connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
  }
}

// =============================================
// Get full plan info for dashboard display
// =============================================
export async function getPlanInfo(userId: string): Promise<{
  plan: PlanTier;
  serviceType: ServiceType;
  subscriptionStatus: SubscriptionStatus;
  isOnTrial: boolean;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  currentPeriodStart: string | null;
  pastDueSince: string | null;
  trialDaysLeft: number;
  features: FeatureAccess;
  planLabel: string;
  priceMonthly: number;
  dailyLimit: number;
  maxDailyEmails: number;
  warmupDay: number;
  warmupComplete: boolean;
  warmupPaused: boolean;
  warmupWeek: number;
  leadsFoundThisMonth: number;
  monthlyLeadFindLimit: number;
  leadsFoundToday: number;
  dailyLeadFindLimit: number;
}> {
  const userPlan = await getUserPlan(userId);
  const dailyInfo = await getDailyLimit(userId);
  const config = PLAN_CONFIGS[userPlan.plan];
  const leadsFoundToday = userPlan.leadsFoundToday;

  const warmupWeek = dailyInfo.warmupDay === 0
    ? 0
    : Math.min(4, Math.ceil(dailyInfo.warmupDay / 7));

  const planLabels: Record<PlanTier, string> = {
    starter: "Starter",
    growth: "Growth",
    agency: "Agency",
  };

  // Calculate trial days remaining
  let trialDaysLeft = 0;
  if (userPlan.isOnTrial && userPlan.trialEndsAt) {
    trialDaysLeft = Math.max(0, Math.ceil((new Date(userPlan.trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
  }

  // Effective limits based on trial status
  const effectiveDailyLeadLimit = userPlan.isOnTrial ? TRIAL_DAILY_LEADS : config.maxDailyEmails;
  const effectiveMonthlyLeadLimit = userPlan.isOnTrial ? TRIAL_MONTHLY_LEADS : config.monthlyLeadFindLimit;

  return {
    plan: userPlan.plan,
    serviceType: userPlan.serviceType,
    subscriptionStatus: userPlan.subscriptionStatus,
    isOnTrial: userPlan.isOnTrial,
    trialEndsAt: userPlan.trialEndsAt,
    currentPeriodEnd: userPlan.currentPeriodEnd,
    currentPeriodStart: userPlan.currentPeriodStart,
    pastDueSince: userPlan.pastDueSince,
    trialDaysLeft,
    features: getFeatureAccess(userPlan.plan, userPlan.isOnTrial),
    planLabel: planLabels[userPlan.plan],
    priceMonthly: config.priceMonthly,
    dailyLimit: dailyInfo.limit,
    maxDailyEmails: userPlan.isOnTrial ? TRIAL_DAILY_EMAILS : config.maxDailyEmails,
    warmupDay: dailyInfo.warmupDay,
    warmupComplete: dailyInfo.warmupComplete,
    warmupPaused: dailyInfo.warmupPaused,
    warmupWeek,
    leadsFoundThisMonth: userPlan.leadsFoundThisMonth,
    monthlyLeadFindLimit: effectiveMonthlyLeadLimit,
    leadsFoundToday,
    dailyLeadFindLimit: effectiveDailyLeadLimit,
  };
}
// =============================================
// Daily AI generation cap (OpenAI cost protection)
// Uses a dedicated counter in user_plans (not DB row count)
// to prevent limit bypass when campaigns/emails are deleted.
// =============================================
export async function getGenerationsToday(userId: string): Promise<number> {
  const userPlan = await getUserPlan(userId);
  return userPlan.emailsGeneratedToday;
}

// =============================================
// Atomically increment daily email generation counter
// The RPC handles auto-reset on new day + increment
// in a single atomic UPDATE (no race conditions).
// This counter NEVER decrements — deleted emails
// still count against the daily generation limit.
// =============================================
export async function incrementEmailsGeneratedToday(userId: string, count: number): Promise<void> {
  await supabase.rpc("increment_emails_generated_today", {
    p_user_id: userId,
    p_count: count,
  });
}

// =============================================
// Atomically CHECK-AND-RESERVE daily generation quota (race-safe).
// Grants min(requested, dailyLimit - usedToday) in a single locked UPDATE, so concurrent
// requests can't both pass a check and overshoot the cap (each generation = a paid GPT call).
// Callers generate ONLY the granted amount and must NOT call incrementEmailsGeneratedToday after.
// Reconcile any unused grant with releaseEmailsGeneratedToday().
// Returns the number of generations granted (0 if the cap is already reached).
// =============================================
export async function reserveGenerationsToday(userId: string, requested: number, dailyLimit: number): Promise<number> {
  if (requested <= 0) return 0;
  const { data, error } = await supabase.rpc("reserve_emails_generated_today", {
    p_user_id: userId,
    p_requested: requested,
    p_limit: dailyLimit,
  });
  if (error) {
    console.error(`[reserveGenerationsToday] RPC error for user ${userId}:`, error.message);
    return 0;
  }
  return typeof data === "number" ? data : 0;
}

// Give back generation quota reserved but not used (invalid/suppressed/failed leads).
// Safe: only reconciles within the same request's grant; never drops the counter below 0.
export async function releaseGenerationsToday(userId: string, count: number): Promise<void> {
  if (count <= 0) return;
  await supabase.rpc("release_emails_generated_today", {
    p_user_id: userId,
    p_count: count,
  });
}

// =============================================
// Atomically increment daily email sent counter
// Same pattern — monotonic, never decrements.
// Deleted campaigns still count against the daily send limit.
// =============================================
export async function incrementEmailsSentToday(userId: string, count: number): Promise<void> {
  await supabase.rpc("increment_emails_sent_today", {
    p_user_id: userId,
    p_count: count,
  });
}

export async function checkDailyGenerationLimit(userId: string): Promise<{
  allowed: boolean;
  remaining: number;
  usedToday: number;
  dailyLimit: number;
  plan: PlanTier;
}> {
  const userPlan = await getUserPlan(userId);

  // SECURITY: Check subscription access first
  const hasAccess = hasActiveSubscription(
    userPlan.subscriptionStatus,
    userPlan.trialEndsAt,
    userPlan.currentPeriodEnd,
    userPlan.pastDueSince
  );
  if (!hasAccess) {
    return { allowed: false, remaining: 0, usedToday: 0, dailyLimit: 0, plan: userPlan.plan };
  }

  const config = PLAN_CONFIGS[userPlan.plan];
  const dailyLimit = userPlan.isOnTrial ? TRIAL_DAILY_GENERATIONS : config.maxDailyGenerations;
  const usedToday = userPlan.emailsGeneratedToday;
  const remaining = Math.max(0, dailyLimit - usedToday);

  return {
    allowed: remaining > 0,
    remaining,
    usedToday,
    dailyLimit, // trial-adjusted (60 during trial), else plan's maxDailyGenerations
    plan: userPlan.plan,
  };
}

// =============================================
// Get max enrich batch size for user's plan
// =============================================
export async function getMaxEnrichBatchSize(userId: string): Promise<number> {
  const userPlan = await getUserPlan(userId);
  if (userPlan.isOnTrial) return TRIAL_ENRICH_BATCH;
  return PLAN_CONFIGS[userPlan.plan].maxEnrichBatchSize;
}

// =============================================
// Set user timezone (auto-detected from browser)
// Validates IANA timezone string before storing.
// Locked to once per 24h to prevent timezone-switching exploits.
// =============================================
export async function setUserTimezone(userId: string, timezone: string): Promise<boolean> {
  if (!timezone || !isValidTimezone(timezone)) return false;

  // Check if timezone was changed in the last 24 hours
  const { data } = await supabase
    .from("user_plans")
    .select("timezone, timezone_updated_at")
    .eq("user_id", userId)
    .single();

  if (data) {
    // If same timezone, no-op (always allow — this is the auto-detect re-sync)
    if (data.timezone === timezone) return true;

    // If timezone was changed within last 24h, block the change
    if (data.timezone_updated_at) {
      const lastChange = new Date(data.timezone_updated_at);
      const hoursSinceChange = (Date.now() - lastChange.getTime()) / (1000 * 60 * 60);
      if (hoursSinceChange < 24) return false;
    }
  }

  await supabase
    .from("user_plans")
    .update({
      timezone,
      timezone_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  return true;
}
