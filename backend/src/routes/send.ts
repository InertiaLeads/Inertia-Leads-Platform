import { Router } from "express";
import { authMiddleware, AuthenticatedRequest } from "../middleware/auth";
import supabase from "../services/supabase";
import { getAllEmailAccounts, getAccountInfo, buildAccountAssignment } from "../services/emailRouter";
import { getDailyLimit, getUserPlan } from "../services/planLimits";
import logger from "../utils/logger";
import { auditLog } from "../utils/auditLog";

const router = Router();

// ===== Business Hours Sending =====
// Optimal cold email send times (research-backed):
// Morning peak: 8:00 AM-12:00 PM | Afternoon peak: 1:00-5:00 PM
// All 7 days, timezone-aware with DST handling
const TIMEZONE_OFFSETS: Record<string, number[]> = {
  // US Timezones
  US_EAST:     [-5, -4],   // EST/EDT (Nov-Mar: -5, Mar-Nov: -4)
  US_CENTRAL:  [-6, -5],   // CST/CDT
  US_MOUNTAIN: [-7, -6],   // MST/MDT (Colorado, Utah, Montana, Wyoming, New Mexico, Idaho)
  US_WEST:     [-8, -7],   // PST/PDT
  US_ALASKA:   [-9, -8],   // AKST/AKDT
  US_HAWAII:   [-10, -10], // HST (no DST)
  // Canada Timezones
  CA_ATLANTIC: [-4, -3],   // AST/ADT (Nova Scotia, New Brunswick, PEI)
  CA_NEWFOUNDLAND: [-3.5, -2.5], // NST/NDT (Newfoundland — half-hour offset)
  // UK & Europe Timezones
  UK:          [0, 1],     // GMT/BST
  EU_CENTRAL:  [1, 2],     // CET/CEST (France, Germany, Spain, Italy, Netherlands, etc.)
  EU_EAST:     [2, 3],     // EET/EEST (Greece, Romania, Finland, Bulgaria, etc.)
  // Middle East
  UAE:         [4, 4],     // GST (Gulf Standard Time — no DST) — UAE, Oman
  ARABIA:     [3, 3],     // AST (Arabia Standard Time — no DST) — Saudi, Qatar, Kuwait, Bahrain, Turkey, Kenya
  // South Asia
  INDIA:       [5.5, 5.5], // IST (no DST — half-hour offset)
  // Southeast Asia
  SINGAPORE:   [8, 8],     // SGT (Singapore — no DST)
  PHILIPPINES: [8, 8],     // PHT (Philippines — no DST)
  // East Asia
  JAPAN:       [9, 9],     // JST (Japan — no DST)
  // Australia Timezones
  AU_WEST:     [8, 8],     // AWST (Perth — no DST)
  AU_CENTRAL:  [9.5, 10.5], // ACST/ACDT (Adelaide, Darwin)
  AU_EAST:     [10, 11],   // AEST/AEDT (Sydney, Melbourne, Brisbane)
  // New Zealand
  NZ:          [12, 13],   // NZST/NZDT
  // South America
  BRAZIL:      [-3, -3],   // BRT (Brasília — no DST since 2019)
  // Africa
  SOUTH_AFRICA: [2, 2],    // SAST (South Africa — no DST)
};

// Determine if DST is active — different rules for US vs UK/EU vs AU vs NZ
function isDSTForRegion(date: Date, region: "US" | "EU" | "AU" | "NZ" | "NONE"): boolean {
  if (region === "NONE") return false;

  const year = date.getUTCFullYear();

  if (region === "US") {
    // US/Canada: Second Sunday of March (2am EST = 7 UTC) → First Sunday of November (2am EDT = 6 UTC)
    const mar1 = new Date(Date.UTC(year, 2, 1));
    const daysToFirstMarSun = (7 - mar1.getUTCDay()) % 7;
    const secondMarSun = 1 + daysToFirstMarSun + 7; // first Sunday + 7 = second Sunday
    const dstStart = new Date(Date.UTC(year, 2, secondMarSun, 7));
    const nov1 = new Date(Date.UTC(year, 10, 1));
    const daysToFirstNovSun = (7 - nov1.getUTCDay()) % 7;
    const firstNovSun = 1 + daysToFirstNovSun;
    const dstEnd = new Date(Date.UTC(year, 10, firstNovSun, 6));
    return date >= dstStart && date < dstEnd;
  } else if (region === "EU") {
    // UK/EU: Last Sunday of March (1am UTC) → Last Sunday of October (1am UTC)
    const mar = new Date(Date.UTC(year, 2, 31));
    const marSun = 31 - mar.getUTCDay(); // last Sunday of March
    const dstStart = new Date(Date.UTC(year, 2, marSun, 1)); // 1am UTC
    const oct = new Date(Date.UTC(year, 9, 31));
    const octSun = 31 - oct.getUTCDay(); // last Sunday of October
    const dstEnd = new Date(Date.UTC(year, 9, octSun, 1)); // 1am UTC
    return date >= dstStart && date < dstEnd;
  } else if (region === "AU") {
    // Australia (southern hemisphere): First Sunday of October → First Sunday of April
    // DST active Oct-Apr (opposite of northern hemisphere)
    const oct1 = new Date(Date.UTC(year, 9, 1));
    const daysToOctSun = (7 - oct1.getUTCDay()) % 7;
    const firstOctSun = 1 + daysToOctSun;
    const dstStart = new Date(Date.UTC(year, 9, firstOctSun, 16)); // 2am AEST = 16 UTC prev day
    const apr1 = new Date(Date.UTC(year, 3, 1));
    const daysToAprSun = (7 - apr1.getUTCDay()) % 7;
    const firstAprSun = 1 + daysToAprSun;
    const dstEnd = new Date(Date.UTC(year, 3, firstAprSun, 16)); // 3am AEDT = 16 UTC
    // Southern hemisphere: DST is Oct→Apr (wraps around new year)
    return date >= dstStart || date < dstEnd;
  } else if (region === "NZ") {
    // New Zealand: Last Sunday of September → First Sunday of April
    const sep = new Date(Date.UTC(year, 8, 30));
    const sepSun = 30 - sep.getUTCDay(); // last Sunday of September
    const dstStart = new Date(Date.UTC(year, 8, sepSun, 14)); // 2am NZST = 14 UTC
    const apr1 = new Date(Date.UTC(year, 3, 1));
    const daysToAprSun = (7 - apr1.getUTCDay()) % 7;
    const firstAprSun = 1 + daysToAprSun;
    const dstEnd = new Date(Date.UTC(year, 3, firstAprSun, 14)); // 3am NZDT = 14 UTC
    return date >= dstStart || date < dstEnd;
  }

  return false;
}

const TIMEZONE_REGIONS: Record<string, "US" | "EU" | "AU" | "NZ" | "NONE"> = {
  US_EAST: "US",
  US_CENTRAL: "US",
  US_MOUNTAIN: "US",
  US_WEST: "US",
  US_ALASKA: "US",
  US_HAWAII: "NONE",
  CA_ATLANTIC: "US",
  CA_NEWFOUNDLAND: "US",
  UK: "EU",
  EU_CENTRAL: "EU",
  EU_EAST: "EU",
  UAE: "NONE",
  ARABIA: "NONE",
  INDIA: "NONE",
  SINGAPORE: "NONE",
  PHILIPPINES: "NONE",
  JAPAN: "NONE",
  AU_WEST: "NONE",
  AU_CENTRAL: "AU",
  AU_EAST: "AU",
  NZ: "NZ",
  BRAZIL: "NONE",
  SOUTH_AFRICA: "NONE",
};

function getLocalHour(date: Date, timezone: string): { hour: number; dayOfWeek: number } {
  const offsets = TIMEZONE_OFFSETS[timezone] || TIMEZONE_OFFSETS.US_EAST;
  const region = TIMEZONE_REGIONS[timezone] || "US";
  const offset = isDSTForRegion(date, region) ? offsets[1] : offsets[0];
  const localMs = date.getTime() + offset * 3600000;
  const local = new Date(localMs);
  return { hour: local.getUTCHours(), dayOfWeek: local.getUTCDay() };
}

// Helper: set a Date to a specific local hour in a given timezone (handles fractional offsets like +5.5)
function setToLocalHour(date: Date, targetHour: number, offset: number): void {
  // Reset to start of UTC day, then compute: targetHour in local = (targetHour - offset) in UTC
  date.setUTCHours(0, 0, 0, 0);
  const offsetMs = (targetHour - offset) * 3600000;
  date.setTime(date.getTime() + offsetMs);
}

// Start of business (default 8:00) on the NEXT calendar day in the campaign's timezone.
// Used by Smart Sequences: an audit-report click moves the next follow-up to "tomorrow morning".
export function nextLocalMorning(timezone: string, from: Date = new Date(), hour = 8): Date {
  const offsets = TIMEZONE_OFFSETS[timezone] || TIMEZONE_OFFSETS.US_EAST;
  const region = TIMEZONE_REGIONS[timezone] || "US";
  const offsetNow = isDSTForRegion(from, region) ? offsets[1] : offsets[0];
  const local = new Date(from.getTime() + offsetNow * 3600000);
  const localTarget = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1, hour, 0, 0);
  // Re-check DST at the target moment (a DST switch overnight changes the offset).
  const guess = new Date(localTarget - offsetNow * 3600000);
  const offsetThen = isDSTForRegion(guess, region) ? offsets[1] : offsets[0];
  return new Date(localTarget - offsetThen * 3600000);
}

// Check if current time is within sending hours
// Initial emails (isFollowUp=false): Mon-Sat during business hours
// Follow-ups (isFollowUp=true): all 7 days during business hours
export function isWithinSendWindow(timezone: string, isFollowUp = false): { canSend: boolean; nextWindowMs: number } {
  const now = new Date();
  const { hour, dayOfWeek } = getLocalHour(now, timezone);

  // Sunday check for initial emails only (0=Sunday)
  const isSunday = dayOfWeek === 0;
  if (isSunday && !isFollowUp) {
    // Calculate next Monday 8am
    const offsets = TIMEZONE_OFFSETS[timezone] || TIMEZONE_OFFSETS.US_EAST;
    const region = TIMEZONE_REGIONS[timezone] || "US";
    const offset = isDSTForRegion(now, region) ? offsets[1] : offsets[0];
    const next = new Date(now);
    next.setUTCDate(next.getUTCDate() + 1); // Sunday→Monday
    setToLocalHour(next, 8, offset);
    return { canSend: false, nextWindowMs: Math.max(0, next.getTime() - now.getTime()) };
  }

  // Morning window: 8:00 AM-12:00 PM | Afternoon window: 1:00-5:00 PM
  const inMorning = hour >= 8 && hour < 12;
  const inAfternoon = hour >= 13 && hour < 17;

  if (inMorning || inAfternoon) {
    return { canSend: true, nextWindowMs: 0 };
  }

  // Calculate next send window
  const offsets = TIMEZONE_OFFSETS[timezone] || TIMEZONE_OFFSETS.US_EAST;
  const region = TIMEZONE_REGIONS[timezone] || "US";
  const offset = isDSTForRegion(now, region) ? offsets[1] : offsets[0];
  const next = new Date(now);

  if (hour < 8) {
    // Before morning window → wait until 8am today
    setToLocalHour(next, 8, offset);
  } else if (hour >= 12 && hour < 13) {
    // Between windows → wait until 1pm today
    setToLocalHour(next, 13, offset);
  } else {
    // After 5pm → next day 8am
    next.setUTCDate(next.getUTCDate() + 1);
    setToLocalHour(next, 8, offset);
    // If next day is Sunday (and not follow-up), skip to Monday
    const nextDay = new Date(next);
    const { dayOfWeek: nextDayOfWeek } = getLocalHour(nextDay, timezone);
    if (!isFollowUp && nextDayOfWeek === 0) {
      next.setUTCDate(next.getUTCDate() + 1);
      setToLocalHour(next, 8, offset);
    }
  }

  return { canSend: false, nextWindowMs: Math.max(0, next.getTime() - now.getTime()) };
}

// Helper: random delay between min and max ms
function delay(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Helper: count emails sent today by this user (monotonic counter)
async function getEmailsSentToday(userId: string): Promise<number> {
  const userPlan = await getUserPlan(userId);
  return userPlan.emailsSentToday;
}

// POST /api/send — Queue a campaign for sending (non-blocking)
// Validates, assigns inboxes, cancels replied follow-ups, then returns immediately.
// Actual email delivery is handled by the background email queue processor.
router.post("/", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { campaignId, leadIds } = req.body;

    if (!campaignId) {
      res.status(400).json({ error: "Campaign ID is required" });
      return;
    }

    // Check if any email account is connected (Gmail or SMTP)
    const allAccounts = await getAllEmailAccounts(req.userId!);
    if (allAccounts.length === 0) {
      res.status(400).json({
        error: "No email account connected. Please connect Gmail or SMTP in Settings first.",
      });
      return;
    }

    // Fetch campaign to get timezone setting
    const { data: campaignData, error: campaignError } = await supabase
      .from("campaigns")
      .select("send_timezone")
      .eq("id", campaignId)
      .eq("user_id", req.userId)
      .single();

    if (campaignError || !campaignData) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }

    const timezone = campaignData.send_timezone || "US_EAST";

    // Check if campaign is already running (prevent duplicate queuing)
    const { data: statusCheck } = await supabase
      .from("campaigns")
      .select("status")
      .eq("id", campaignId)
      .eq("user_id", req.userId)
      .single();

    if (statusCheck?.status === "running") {
      res.json({
        message: "Campaign is already running. Emails will be sent during the next business hour window.",
        queued: true, total: 0,
      });
      return;
    }

    // Check daily limit (plan-based with warmup)
    const sentToday = await getEmailsSentToday(req.userId!);
    const { limit: DAILY_SEND_LIMIT, warmupDay, warmupComplete, plan } = await getDailyLimit(req.userId!);

    // Gmail/SMTP not connected or plan inactive — no sending
    if (DAILY_SEND_LIMIT === 0) {
      res.status(400).json({
        error: "No email account connected or plan inactive. Please connect an account in Settings first.",
      });
      return;
    }

    // Count pending emails for this campaign
    const now = new Date().toISOString();
    let emailQuery = supabase
      .from("emails")
      .select("*")
      .eq("campaign_id", campaignId)
      .eq("user_id", req.userId)
      .eq("status", "pending")
      .order("sequence_step", { ascending: true });

    // If specific lead IDs provided, only include emails for those leads
    if (Array.isArray(leadIds) && leadIds.length > 0) {
      emailQuery = emailQuery.in("lead_id", leadIds);
    }

    const { data: emails, error: emailsError } = await emailQuery;

    if (emailsError || !emails || emails.length === 0) {
      if (sentToday >= DAILY_SEND_LIMIT) {
        res.status(429).json({
          error: `Daily send limit reached (${DAILY_SEND_LIMIT}/day). Try again tomorrow to protect your email account.`,
        });
        return;
      }
      res.status(404).json({ error: "No pending emails found for this campaign" });
      return;
    }

    // Split into initials and follow-ups for inbox assignment
    const initialEmails = emails.filter(e => (e.sequence_step || 1) === 1);
    const followUpEmails = emails.filter(e => (e.sequence_step || 1) > 1);

    // Cancel follow-ups for leads that already replied
    const repliedLeadIds = new Set<string>();
    if (followUpEmails.length > 0) {
      const uniqueLeadIds = [...new Set(followUpEmails.map(e => e.lead_id).filter(Boolean))];
      if (uniqueLeadIds.length > 0) {
        const { data: repliedEmails } = await supabase
          .from("emails")
          .select("lead_id")
          .eq("user_id", req.userId)
          .in("lead_id", uniqueLeadIds)
          .eq("replied", true);
        if (repliedEmails) {
          repliedEmails.forEach(e => repliedLeadIds.add(e.lead_id));
        }
      }
    }

    const cancelledFollowUps = followUpEmails.filter(e => repliedLeadIds.has(e.lead_id));
    if (cancelledFollowUps.length > 0) {
      await supabase
        .from("emails")
        .update({ status: "cancelled" })
        .eq("user_id", req.userId)
        .in("id", cancelledFollowUps.map(e => e.id));
    }

    // ===== INBOX ROTATION: Assign email accounts (Gmail + SMTP) =====
    const leadToAccount = new Map<string, { id: string; type: "gmail" | "smtp" }>();
    let rrIndex = 0;

    // Assign initials via round-robin across all connected accounts
    for (const email of initialEmails) {
      if (!email.gmail_account_id && !email.smtp_account_id) {
        const account = allAccounts[rrIndex % allAccounts.length];
        if (account.type === "gmail") {
          email.gmail_account_id = account.id;
        } else {
          email.smtp_account_id = account.id;
        }
        rrIndex++;
      }
      if (email.lead_id) {
        const info = getAccountInfo(email);
        if (info) leadToAccount.set(email.lead_id, info);
      }
    }

    // Assign follow-ups to match their initial email's account (thread consistency)
    const activeFollowUps = followUpEmails.filter(e => !repliedLeadIds.has(e.lead_id));
    for (const email of activeFollowUps) {
      if (!email.gmail_account_id && !email.smtp_account_id && email.lead_id) {
        let account = leadToAccount.get(email.lead_id);
        if (!account) {
          const { data: initial } = await supabase
            .from("emails")
            .select("gmail_account_id, smtp_account_id")
            .eq("user_id", req.userId)
            .eq("lead_id", email.lead_id)
            .eq("campaign_id", campaignId)
            .eq("sequence_step", 1)
            .single();
          if (initial) account = getAccountInfo(initial) ?? undefined;
          if (!account) account = { id: allAccounts[0].id, type: allAccounts[0].type };
        }
        if (account.type === "gmail") {
          email.gmail_account_id = account.id;
        } else {
          email.smtp_account_id = account.id;
        }
      }
    }

    // Batch update account assignments in DB
    const allAssignableEmails = [...initialEmails, ...activeFollowUps];
    for (const email of allAssignableEmails) {
      const info = getAccountInfo(email);
      if (info) {
        await supabase
          .from("emails")
          .update(buildAccountAssignment(info.id, info.type))
          .eq("id", email.id)
          .eq("user_id", req.userId);
      }
    }
    // ===== END INBOX ROTATION =====

    // Set campaign to "running" — background queue will handle actual sending
    await supabase
      .from("campaigns")
      .update({ status: "running" })
      .eq("id", campaignId)
      .eq("user_id", req.userId);

    const remaining = Math.max(0, DAILY_SEND_LIMIT - sentToday);
    const totalQueued = allAssignableEmails.length;

    // Check business hours for informative messaging
    const initialSendWindow = isWithinSendWindow(timezone, false);
    const tzLabel = timezone.replace("_", " ");

    let message: string;
    if (!initialSendWindow.canSend) {
      const waitMins = Math.ceil(initialSendWindow.nextWindowMs / 60000);
      const waitHrs = Math.floor(waitMins / 60);
      const remainMins = waitMins % 60;
      const waitStr = waitHrs > 0 ? `${waitHrs}h ${remainMins}m` : `${waitMins}m`;
      message = `Campaign queued! Outside ${tzLabel} sending hours. Emails will auto-send during the next window (Mon-Sat 8 AM-12 PM & 1-5 PM ${tzLabel}) in ~${waitStr}.`;
    } else {
      message = `Campaign launched! ${totalQueued} emails queued for sending. They'll be sent automatically with proper delays to protect your inbox reputation.`;
    }

    logger.info({ campaignId, userId: req.userId, totalQueued, cancelled: cancelledFollowUps.length }, "Campaign queued for sending");
    auditLog({ userId: req.userId, action: "email.send", resource: "campaigns", resourceId: campaignId, req, metadata: { totalQueued, cancelled: cancelledFollowUps.length } });

    res.json({
      message,
      queued: true,
      total: totalQueued,
      cancelled: cancelledFollowUps.length,
      dailyLimitRemaining: remaining,
      plan,
      warmupDay,
      warmupComplete,
      dailyLimit: DAILY_SEND_LIMIT,
    });
  } catch {
    res.status(500).json({ error: "Failed to queue campaign" });
  }
});

// POST /api/send/mark-reply — Manually mark an email as replied
router.post("/mark-reply", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { emailId } = req.body;

    if (!emailId) {
      res.status(400).json({ error: "Email ID is required" });
      return;
    }

    // Get the email to find lead_id and campaign_id
    const { data: email } = await supabase
      .from("emails")
      .select("id, lead_id, campaign_id")
      .eq("id", emailId)
      .eq("user_id", req.userId)
      .single();

    if (!email) {
      res.status(404).json({ error: "Email not found" });
      return;
    }

    const { error } = await supabase
      .from("emails")
      .update({
        replied: true,
        replied_at: new Date().toISOString(),
      })
      .eq("id", emailId)
      .eq("user_id", req.userId);

    if (error) {
      res.status(500).json({ error: "Failed to mark reply" });
      return;
    }

    // Cancel all pending follow-ups for this lead (no point sending them)
    if (email.lead_id) {
      await supabase
        .from("emails")
        .update({ status: "cancelled" })
        .eq("lead_id", email.lead_id)
        .eq("user_id", req.userId)
        .eq("status", "pending");
    }

    // Check if campaign should be marked as completed
    if (email.campaign_id) {
      const { count: pendingCount } = await supabase
        .from("emails")
        .select("*", { count: "exact", head: true })
        .eq("campaign_id", email.campaign_id)
        .eq("status", "pending");

      if (pendingCount === 0) {
        const { count: sentCount } = await supabase
          .from("emails")
          .select("*", { count: "exact", head: true })
          .eq("campaign_id", email.campaign_id)
          .eq("status", "sent");

        const finalStatus = (sentCount && sentCount > 0) ? "completed" : "draft";
        await supabase
          .from("campaigns")
          .update({ status: finalStatus })
          .eq("id", email.campaign_id)
          .eq("user_id", req.userId);
      }
    }

    res.json({ message: "Email marked as replied" });
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
