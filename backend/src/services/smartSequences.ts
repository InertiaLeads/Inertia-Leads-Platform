import supabase from "./supabase";
import logger from "../utils/logger";
import { isAuditUrl } from "./tracking";
import { getUserFeatures } from "./planLimits";
import { nextLocalMorning } from "../routes/send";

// =============================================
// Behaviour-based smart sequences
// =============================================
// V1 follow-ups are purely time-based (scheduled_at set at generation time). When a campaign
// has smart_sequences_enabled, lead behaviour adjusts the sequence:
//
//   open/click events (public tracking endpoints)  → onTrackingEvent()
//     • audit link clicked           → next follow-up goes the next morning
//     • 2+ separate opens, no reply  → next follow-up goes the next morning
//     • opens + clicks ≥ threshold   → "hot" — display-only, derived from counts at read time
//   reply classification (services/replyClassifier) → pauseSequenceForLead() / cancelSequenceForLead()
//
// Every action is stamped on the email rows (triggered_by / trigger_condition / accelerated_at) so the UI can show what the system did and so no trigger fires twice.

export interface SmartSequenceConfig {
  accelerate_on_opens: boolean;
  accelerate_opens_threshold: number;
  accelerate_opens_hours: number;
  accelerate_on_audit_click: boolean;
  accelerate_click_hours: number;
  hot_lead_flag: boolean;
  hot_lead_opens_threshold: number;
}

export const DEFAULT_SMART_CONFIG: SmartSequenceConfig = {
  accelerate_on_opens: true,
  accelerate_opens_threshold: 2,
  accelerate_opens_hours: 4,
  accelerate_on_audit_click: true,
  accelerate_click_hours: 2,
  hot_lead_flag: true,
  hot_lead_opens_threshold: 3,
};

// Merge a stored JSONB config with defaults and clamp numbers to sane ranges.
// Used both when reading (queue/evaluator) and when validating a PUT from the UI.
export function normalizeSmartConfig(raw: unknown): SmartSequenceConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const bool = (k: keyof SmartSequenceConfig) => (typeof r[k] === "boolean" ? (r[k] as boolean) : DEFAULT_SMART_CONFIG[k] as boolean);
  const num = (k: keyof SmartSequenceConfig, min: number, max: number) => {
    const v = Number(r[k]);
    if (!Number.isFinite(v)) return DEFAULT_SMART_CONFIG[k] as number;
    return Math.min(max, Math.max(min, Math.round(v)));
  };
  return {
    accelerate_on_opens: bool("accelerate_on_opens"),
    accelerate_opens_threshold: num("accelerate_opens_threshold", 2, 10),
    accelerate_opens_hours: num("accelerate_opens_hours", 1, 48),
    accelerate_on_audit_click: bool("accelerate_on_audit_click"),
    accelerate_click_hours: num("accelerate_click_hours", 1, 48),
    hot_lead_flag: bool("hot_lead_flag"),
    hot_lead_opens_threshold: num("hot_lead_opens_threshold", 2, 20),
  };
}

interface CampaignSmart {
  id: string;
  user_id: string;
  status: string;
  send_timezone: string | null;
  smart_sequences_enabled: boolean;
  smart_sequence_config: unknown;
}

async function loadCampaign(campaignId: string): Promise<CampaignSmart | null> {
  const { data } = await supabase
    .from("campaigns")
    .select("id, user_id, status, send_timezone, smart_sequences_enabled, smart_sequence_config")
    .eq("id", campaignId)
    .single();
  return (data as CampaignSmart) || null;
}

async function leadHasReplied(leadId: string, campaignId: string): Promise<boolean> {
  const { data } = await supabase
    .from("emails")
    .select("id")
    .eq("lead_id", leadId)
    .eq("campaign_id", campaignId)
    .eq("replied", true)
    .limit(1);
  return !!(data && data.length > 0);
}

// Pull the NEXT pending follow-up for this lead forward to `target` (next local morning).
// Once per follow-up (accelerated_at guard); never pushes a follow-up later than it already was.
//
// Only ONE moved-up follow-up may be waiting at a time: we always look at the lowest pending
// step, and if that one is already moved up we stop. So several clicks/opens on the same day
// can't also pull follow-up 2 onto that same morning — follow-up 2 can only move after
// follow-up 1 has actually been sent and the lead engages again (→ the next morning after that).
async function accelerateNextFollowUp(
  leadId: string,
  campaignId: string,
  target: Date,
  trigger: string
): Promise<boolean> {
  const { data: next } = await supabase
    .from("emails")
    .select("id, scheduled_at, sequence_step, accelerated_at")
    .eq("lead_id", leadId)
    .eq("campaign_id", campaignId)
    .eq("status", "pending")
    .gt("sequence_step", 1)
    .order("sequence_step", { ascending: true })
    .limit(1);

  const followUp = next && next[0];
  if (!followUp) return false;
  if (followUp.accelerated_at) return false; // the next follow-up is already moved up — wait for it to send

  if (followUp.scheduled_at && new Date(followUp.scheduled_at) <= target) return false; // already sooner

  const { error } = await supabase
    .from("emails")
    .update({
      scheduled_at: target.toISOString(),
      accelerated_at: new Date().toISOString(),
      triggered_by: "accelerated",
      trigger_condition: { trigger, send_at: target.toISOString(), previous_scheduled_at: followUp.scheduled_at, at: new Date().toISOString() },
    })
    .eq("id", followUp.id)
    .eq("status", "pending")
    .is("accelerated_at", null); // two near-simultaneous events can't both move it

  if (error) {
    logger.warn({ error: error.message, emailId: followUp.id }, "Failed to accelerate follow-up");
    return false;
  }
  logger.info({ leadId, campaignId, emailId: followUp.id, trigger, sendAt: target.toISOString() }, "Smart sequence: follow-up accelerated");
  return true;
}

// Two opens count separately only if they are at least this far apart.
const REOPEN_GAP_MS = 15 * 60 * 1000;

// Count opens, merging any that happen within `gapMs` of the last counted one.
export function countSeparatedOpens(timestamps: string[], gapMs: number): number {
  let count = 0;
  let last = -Infinity;
  for (const t of timestamps.map((x) => new Date(x).getTime()).sort((a, b) => a - b)) {
    if (t - last >= gapMs) { count += 1; last = t; }
  }
  return count;
}

// Entry point for the public tracking endpoints. Fire-and-forget; never throws to the caller.
export async function onTrackingEvent(emailId: string, type: "open" | "click", url?: string): Promise<void> {
  try {
    const { data: email } = await supabase
      .from("emails")
      .select("id, lead_id, campaign_id, sequence_step")
      .eq("id", emailId)
      .single();
    if (!email || !email.lead_id || !email.campaign_id) return;

    const campaign = await loadCampaign(email.campaign_id);
    if (!campaign || !campaign.smart_sequences_enabled) return;
    if (!(await getUserFeatures(campaign.user_id)).smartSequences) return; // Growth+ only
    const cfg = normalizeSmartConfig(campaign.smart_sequence_config);

    if (await leadHasReplied(email.lead_id, email.campaign_id)) return;

    if (type === "click") {
      // Audit-report click: the next unsent follow-up moves to tomorrow morning (start of business
      // hours in the campaign's timezone) instead of waiting its usual days. A later click on that
      // follow-up's report moves the one after it to the next morning again.
      if (cfg.accelerate_on_audit_click && url && isAuditUrl(url)) {
        await accelerateNextFollowUp(email.lead_id, email.campaign_id, nextLocalMorning(campaign.send_timezone || "US_EAST"), "audit_link_clicked");
      }
      return;
    }

    // open: count opens across every email for this lead in this campaign (initial, resend, follow-ups)
    // Opened N+ times without replying → next follow-up goes out the next morning.
    // Only REAL re-opens count: opens less than 15 minutes apart are treated as one (mail apps
    // and security scanners often load an email several times in a burst on their own).
    if (cfg.accelerate_on_opens) {
      const { data: leadEmails } = await supabase
        .from("emails")
        .select("id")
        .eq("lead_id", email.lead_id)
        .eq("campaign_id", email.campaign_id);
      const ids = (leadEmails || []).map((r) => r.id);
      const { data: opens } = ids.length
        ? await supabase.from("email_events").select("created_at").in("email_id", ids).eq("event_type", "open").order("created_at", { ascending: true })
        : { data: [] as Array<{ created_at: string }> };
      const realOpens = countSeparatedOpens((opens || []).map((o) => o.created_at), REOPEN_GAP_MS);
      if (realOpens >= cfg.accelerate_opens_threshold) {
        await accelerateNextFollowUp(email.lead_id, email.campaign_id, nextLocalMorning(campaign.send_timezone || "US_EAST"), `opened_${realOpens}x_no_reply`);
      }
    }
  } catch (err) {
    logger.warn({ err, emailId, type }, "onTrackingEvent failed");
  }
}

// =============================================
// Reply-driven actions (called by services/replyClassifier.ts)
// =============================================

// Out of office: move every pending follow-up for this lead in this campaign to the return
// date itself (sent in the first business-hours window of that day). Automatic path never
// moves a follow-up earlier; the manual path (exact) can.
// `exact` = true is the manual override from the Inbox: the user picked the resume date, so
// follow-ups are moved to it even if that is EARLIER than their current schedule (the
// automatic path only ever pushes later). A user date that is today/past resumes immediately.
export async function pauseSequenceForLead(leadId: string, campaignId: string, returnDate: string | null, exact = false): Promise<number> {
  let resumeAt: Date;
  if (returnDate && /^\d{4}-\d{2}-\d{2}$/.test(returnDate)) {
    // Start of that day (UTC) so the queue sends in the first business-hours window of the day.
    resumeAt = new Date(`${returnDate}T00:00:00Z`);
    const max = Date.now() + 365 * 24 * 60 * 60 * 1000;
    if (Number.isNaN(resumeAt.getTime()) || resumeAt.getTime() > max) {
      resumeAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    } else if (resumeAt.getTime() < Date.now()) {
      // Date already passed: resume now (manual) or fall back to 7 days (automatic guess)
      resumeAt = exact ? new Date() : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    }
  } else {
    resumeAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  }

  const { data: pending } = await supabase
    .from("emails")
    .select("id, scheduled_at")
    .eq("lead_id", leadId)
    .eq("campaign_id", campaignId)
    .eq("status", "pending")
    .gt("sequence_step", 1);

  let moved = 0;
  for (const e of pending || []) {
    const current = e.scheduled_at ? new Date(e.scheduled_at) : new Date(0);
    if (!exact && current >= resumeAt) continue;
    await supabase
      .from("emails")
      .update({
        scheduled_at: resumeAt.toISOString(),
        triggered_by: "paused",
        trigger_condition: { trigger: "out_of_office", return_date: returnDate, resume_at: resumeAt.toISOString(), set_by: exact ? "user" : "auto", at: new Date().toISOString() },
      })
      .eq("id", e.id)
      .eq("status", "pending");
    moved += 1;
  }
  if (moved > 0) logger.info({ leadId, campaignId, resumeAt: resumeAt.toISOString(), moved }, "Smart sequence: sequence paused (out of office)");
  return moved;
}

// Cancel every pending email for this lead in this campaign (not interested / bounce).
// `smartAction` = true stamps triggered_by='cancelled' so the UI shows the "Cancelled" badge;
// false is used for the plain V1 "lead replied" cancellation.
export async function cancelSequenceForLead(leadId: string, campaignId: string, reason: string, smartAction = true): Promise<number> {
  const { data } = await supabase
    .from("emails")
    .update({
      status: "cancelled",
      error_log: `Cancelled: ${reason}`,
      ...(smartAction ? { triggered_by: "cancelled", trigger_condition: { trigger: reason, at: new Date().toISOString() } } : {}),
    })
    .eq("lead_id", leadId)
    .eq("campaign_id", campaignId)
    .eq("status", "pending")
    .select("id");
  const n = data?.length || 0;
  if (n > 0) logger.info({ leadId, campaignId, reason, cancelled: n }, "Sequence cancelled");
  return n;
}
