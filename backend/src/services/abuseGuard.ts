import supabase from "./supabase";
import logger from "../utils/logger";
import { getUserPlan } from "./planLimits";

// =============================================
// Abuse guard — protect the shared tracking/link domain
// =============================================
// Every tenant's tracked links point at the same tracking domain. One user blasting a junk
// list (mass bounces, mass "unsubscribe" replies) can get that domain flagged and hurt every
// honest tenant. This brake pauses THAT user's sending before the damage spreads.
//
// Thresholds are deliberately conservative so a normal day never trips it:
//   • at least MIN_SENT_TODAY emails sent today (small samples are noise), AND
//   • bounces + unsubscribe replies today > MAX_BAD_RATIO of sends today
// A single unsubscribe only ever cancels that one lead (see suppression.ts) — never the user.
//
// Effect: running campaigns → 'draft' (the same state the UI's own "stop" uses), and
// user_plans.auto_paused_at / auto_pause_reason are set so the dashboard shows a warning.
// Nothing is deleted; the user reviews their list and resumes.

const MIN_SENT_TODAY = 30;
const MAX_BAD_RATIO = 0.10;

export async function checkAbuseAndAutoPause(userId: string): Promise<boolean> {
  try {
    const plan = await getUserPlan(userId);
    const sentToday = plan.emailsSentToday || 0;
    if (sentToday < MIN_SENT_TODAY) return false;

    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);

    const { count: badToday } = await supabase
      .from("replies")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("direction", "inbound")
      .in("classification", ["bounce", "unsubscribe"])
      .gte("received_at", dayStart.toISOString());

    const bad = badToday || 0;
    const ratio = bad / sentToday;
    if (ratio <= MAX_BAD_RATIO) return false;

    // Already paused today? Don't re-pause / re-log.
    const { data: planRow } = await supabase.from("user_plans").select("auto_paused_at").eq("user_id", userId).single();
    if (planRow?.auto_paused_at && new Date(planRow.auto_paused_at) >= dayStart) return false;

    const { data: paused } = await supabase
      .from("campaigns")
      .update({ status: "draft" })
      .eq("user_id", userId)
      .eq("status", "running")
      .select("id");

    const reason = `Sending paused automatically: ${bad} of ${sentToday} emails sent today bounced or received an unsubscribe reply (${Math.round(ratio * 100)}%). Review your lead list quality, then reactivate your campaigns.`;
    await supabase
      .from("user_plans")
      .update({ auto_paused_at: new Date().toISOString(), auto_pause_reason: reason, updated_at: new Date().toISOString() })
      .eq("user_id", userId);

    logger.warn({ userId, sentToday, bad, ratio: ratio.toFixed(2), campaignsPaused: paused?.length || 0 }, "Abuse guard: user auto-paused");
    return true;
  } catch (err) {
    logger.error({ err, userId }, "Abuse guard check failed");
    return false;
  }
}

// User acknowledged the warning (dashboard banner) — clear the flag. Campaigns are
// reactivated by the user from the campaign page as usual.
export async function clearAutoPause(userId: string): Promise<void> {
  await supabase
    .from("user_plans")
    .update({ auto_paused_at: null, auto_pause_reason: null, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
}
