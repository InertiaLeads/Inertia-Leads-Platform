import supabase from "../services/supabase";
import { sendEmailUnified, getInboxSentTodayUnified, getPrimaryEmailAccountId, getAccountInfo, buildAccountAssignment } from "../services/emailRouter";
import { isWithinSendWindow } from "../routes/send";
import { getDailyLimit, GMAIL_INBOX_CAP, getUserPlan, incrementEmailsSentToday } from "../services/planLimits";
import { isSuppressed } from "../services/suppression";
import { buildUnsubscribeUrl } from "../utils/unsubscribe";
import logger from "../utils/logger";
import crypto from "crypto";

// Distributed lock name — must match the pre-inserted row in job_locks table
const LOCK_NAME = "email_queue";
// Unique instance ID — identifies which process holds the lock
const INSTANCE_ID = `eq_${crypto.randomBytes(4).toString("hex")}_${process.pid}`;

const MAX_RETRIES = 2;
const INITIAL_BATCH_SIZE = 10;   // Process up to 10 initial emails per campaign per cycle
const FOLLOW_UP_BATCH_SIZE = 15; // Process up to 15 follow-ups per campaign per cycle
// Emails left in "sending" longer than this were orphaned by a crash mid-send;
// the reaper recovers them (without resending, to avoid duplicate delivery).
const STUCK_SENDING_TIMEOUT_MIN = 15;
// How often a working process re-stamps its lock so it never looks stale while alive.
const HEARTBEAT_INTERVAL_MS = 60 * 1000;

// Exponential backoff: retry 1 = 5 min, retry 2 = 15 min
function getRetryDelay(retryCount: number): Date {
  const delayMinutes = retryCount === 1 ? 5 : 15;
  return new Date(Date.now() + delayMinutes * 60 * 1000);
}

function delay(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Check how many emails a user sent today (monotonic counter)
async function getUserSentToday(userId: string): Promise<number> {
  const userPlan = await getUserPlan(userId);
  return userPlan.emailsSentToday;
}

// Atomically claim an email for sending: flip pending -> sending ONLY if it is
// still pending. Postgres row-locking serializes concurrent claims, so at most
// one worker can win — this is what guarantees no email is ever sent twice,
// even if two cycles or two server instances overlap. Returns true if we won.
async function claimEmail(emailId: string): Promise<boolean> {
  const { data } = await supabase
    .from("emails")
    .update({ status: "sending", claimed_at: new Date().toISOString() })
    .eq("id", emailId)
    .eq("status", "pending")
    .select("id");
  return !!(data && data.length > 0);
}

// Release a claim we couldn't actually act on (no inbox connected, inbox at cap):
// put it back to pending so a later cycle can try again.
async function revertClaim(emailId: string): Promise<void> {
  await supabase
    .from("emails")
    .update({ status: "pending", claimed_at: null })
    .eq("id", emailId)
    .eq("status", "sending");
}

// Reaper: recover emails stranded in "sending" by a process that died between
// the provider accepting the message and us writing status='sent'. We deliberately
// do NOT resend — the message may already have been delivered, and a missed send
// is far safer than emailing a prospect twice. Runs once per cycle.
async function reapStuckSends(): Promise<void> {
  const cutoff = new Date(Date.now() - STUCK_SENDING_TIMEOUT_MIN * 60 * 1000).toISOString();
  const { data: stuck } = await supabase
    .from("emails")
    .select("id, lead_id, campaign_id, sequence_step")
    .eq("status", "sending")
    .lt("claimed_at", cutoff);

  if (!stuck || stuck.length === 0) return;

  for (const email of stuck) {
    await supabase
      .from("emails")
      .update({
        status: "failed",
        error_log: "Send interrupted (process stopped mid-send). Not auto-retried to avoid duplicate delivery.",
      })
      .eq("id", email.id)
      .eq("status", "sending");

    // If an initial email was orphaned, cancel its pending follow-ups (consistent
    // with how a permanently-failed initial email is handled).
    if ((email.sequence_step || 1) === 1 && email.lead_id && email.campaign_id) {
      await supabase
        .from("emails")
        .update({ status: "cancelled", error_log: "Cancelled: initial send interrupted" })
        .eq("lead_id", email.lead_id)
        .eq("campaign_id", email.campaign_id)
        .eq("status", "pending")
        .gt("sequence_step", 1);
    }
  }
  logger.warn({ count: stuck.length }, "Reaper: marked crash-orphaned 'sending' emails as failed");
}

// Send a single email with all safety checks, returns true if sent
async function sendSingleEmail(
  email: any,
  campaign: { id: string; user_id: string },
): Promise<boolean> {
  // Atomically claim this email (pending -> sending). If we don't win the claim,
  // another worker/cycle already has it — skip silently. This is the core
  // guarantee that no email is ever sent more than once.
  const won = await claimEmail(email.id);
  if (!won) {
    logger.debug({ emailId: email.id }, "Email already claimed elsewhere, skipping");
    return false;
  }

  // Respect unsubscribes — never send to a suppressed address. Cancel this email
  // (and, if it's the initial, its pending follow-ups) instead of sending.
  if (await isSuppressed(campaign.user_id, email.to_email)) {
    await supabase
      .from("emails")
      .update({ status: "cancelled", error_log: "Cancelled: recipient unsubscribed" })
      .eq("id", email.id);
    if ((email.sequence_step || 1) === 1 && email.lead_id) {
      await supabase
        .from("emails")
        .update({ status: "cancelled", error_log: "Cancelled: recipient unsubscribed" })
        .eq("lead_id", email.lead_id)
        .eq("campaign_id", campaign.id)
        .eq("status", "pending")
        .gt("sequence_step", 1);
    }
    logger.info({ emailId: email.id, to: email.to_email }, "Skipped send — recipient unsubscribed");
    return false;
  }

  // Resolve which email account to send from
  let accountInfo = getAccountInfo(email);
  if (!accountInfo) {
    const isFollowUp = (email.sequence_step || 1) > 1;
    if (isFollowUp && email.lead_id) {
      const { data: initial } = await supabase
        .from("emails")
        .select("gmail_account_id, smtp_account_id")
        .eq("lead_id", email.lead_id)
        .eq("campaign_id", campaign.id)
        .eq("sequence_step", 1)
        .single();
      if (initial) accountInfo = getAccountInfo(initial);
    }
    if (!accountInfo) {
      const primary = await getPrimaryEmailAccountId(campaign.user_id);
      if (primary) accountInfo = primary;
    }
    if (!accountInfo) {
      // No inbox to send from — release the claim so it retries once one is connected.
      await revertClaim(email.id);
      logger.warn({ userId: campaign.user_id, emailId: email.id }, "No email account found, skipping");
      return false;
    }
    // Save assignment for future consistency
    await supabase
      .from("emails")
      .update(buildAccountAssignment(accountInfo.id, accountInfo.type))
      .eq("id", email.id);
  }

  // Per-inbox safety cap (450/inbox/day)
  const inboxSent = await getInboxSentTodayUnified(accountInfo.id, accountInfo.type);
  if (inboxSent >= GMAIL_INBOX_CAP) {
    // Inbox at its daily cap — release the claim so it can send later / from another inbox.
    await revertClaim(email.id);
    logger.info({ inboxId: accountInfo.id, accountType: accountInfo.type, inboxSent, cap: GMAIL_INBOX_CAP }, "Inbox hit cap, skipping");
    return false;
  }

  const result = await sendEmailUnified(
    accountInfo.id,
    accountInfo.type,
    email.to_email,
    email.subject,
    email.body,
    buildUnsubscribeUrl(campaign.user_id, email.to_email)
  );

  if (!result.success) {
    // Provider reported failure without throwing. Treat as a send error so the
    // retry/backoff path handles it — otherwise the claim would stay "sending".
    throw new Error("Email provider reported send failure");
  }

  await supabase
    .from("emails")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      error_log: null,
    })
    .eq("id", email.id);

  // Increment monotonic daily sent counter (never decrements)
  await incrementEmailsSentToday(campaign.user_id, 1);

  // Mark lead as contacted (only on first email)
  if ((email.sequence_step || 1) === 1 && email.lead_id) {
    await supabase
      .from("leads")
      .update({ contacted: true, contacted_at: new Date().toISOString() })
      .eq("id", email.lead_id);
  }

  const sequenceInfo = email.sequence_step === 1 ? "(initial)" : `(follow-up ${email.sequence_step - 1})`;
  logger.info({ emailId: email.id, to: email.to_email, sequenceInfo, accountType: accountInfo.type }, "Email sent");
  return true;
}

// Handle send failure with retry logic
async function handleSendError(email: any, err: unknown): Promise<void> {
  const errorMsg = err instanceof Error ? err.message : String(err);
  const currentRetry = (email.retry_count || 0) + 1;

  if (currentRetry <= MAX_RETRIES) {
    const retryAt = getRetryDelay(currentRetry);
    await supabase
      .from("emails")
      .update({
        status: "pending", // release the claim back to pending so the retry can pick it up
        claimed_at: null,
        retry_count: currentRetry,
        error_log: errorMsg,
        scheduled_at: retryAt.toISOString(),
      })
      .eq("id", email.id);
    logger.warn({ emailId: email.id, retry: currentRetry, retryAt: retryAt.toISOString(), error: errorMsg }, "Retrying email with backoff");
  } else {
    await supabase
      .from("emails")
      .update({
        status: "failed",
        retry_count: currentRetry,
        error_log: errorMsg,
      })
      .eq("id", email.id);
    logger.error({ emailId: email.id, retries: MAX_RETRIES, error: errorMsg }, "Email failed permanently");

    // If the initial email failed permanently, cancel all its follow-ups
    // (no point sending follow-up #2/#3 if the first email never reached the lead)
    if ((email.sequence_step || 1) === 1 && email.lead_id && email.campaign_id) {
      const { data: cancelled } = await supabase
        .from("emails")
        .update({ status: "cancelled", error_log: "Cancelled: initial email failed" })
        .eq("lead_id", email.lead_id)
        .eq("campaign_id", email.campaign_id)
        .eq("status", "pending")
        .gt("sequence_step", 1)
        .select("id");
      if (cancelled && cancelled.length > 0) {
        logger.info({ emailId: email.id, leadId: email.lead_id, cancelledCount: cancelled.length }, "Cancelled follow-ups for failed initial email");
      }
    }
  }
}

async function processEmailQueue() {
  // Acquire table-based distributed lock — if another instance holds it, skip this cycle
  // Lock auto-expires after 5 minutes (stale lock protection if process crashes)
  const { data: acquired } = await supabase.rpc("acquire_job_lock", {
    p_lock_name: LOCK_NAME,
    p_locked_by: INSTANCE_ID,
  });
  if (!acquired) {
    logger.debug("Email queue: another instance holds the lock, skipping cycle");
    return;
  }

  // Keep the lock fresh while we work. A long run (many emails × 45–90s delays)
  // can exceed the 5-minute stale-lock TTL; the heartbeat re-stamps locked_at
  // every minute so the lock only ever expires if this process actually dies —
  // closing the window where a second cycle could start and double-send.
  const heartbeat = setInterval(() => {
    supabase
      .rpc("heartbeat_job_lock", { p_lock_name: LOCK_NAME, p_locked_by: INSTANCE_ID })
      .then(() => {}, () => { /* transient DB error — lock survives until next beat */ });
  }, HEARTBEAT_INTERVAL_MS);

  try {
    // Recover any emails left in "sending" by a previous run that crashed mid-send.
    await reapStuckSends();

    const { data: campaigns, error: campaignsError } = await supabase
      .from("campaigns")
      .select("id, user_id, send_timezone")
      .eq("status", "running");

    if (campaignsError || !campaigns || campaigns.length === 0) return;

    for (const campaign of campaigns) {
      const timezone = campaign.send_timezone || "US_EAST";
      const followUpWindow = isWithinSendWindow(timezone, true);
      const initialWindow = isWithinSendWindow(timezone, false);

      // If neither can send (outside business hours entirely), skip
      if (!followUpWindow.canSend && !initialWindow.canSend) {
        continue;
      }

      const now = new Date().toISOString();

      // ===== PROCESS INITIAL EMAILS (batch) =====
      if (initialWindow.canSend) {
        const sentToday = await getUserSentToday(campaign.user_id);
        const { limit: dailyLimit } = await getDailyLimit(campaign.user_id);
        const remaining = Math.max(0, dailyLimit - sentToday);
        const batchSize = Math.min(INITIAL_BATCH_SIZE, remaining);

        if (batchSize > 0) {
          const { data: initialEmails } = await supabase
            .from("emails")
            .select("*")
            .eq("campaign_id", campaign.id)
            .eq("status", "pending")
            .eq("sequence_step", 1)
            .or(`scheduled_at.is.null,scheduled_at.lte.${now}`)
            .order("created_at", { ascending: true })
            .limit(batchSize);

          if (initialEmails && initialEmails.length > 0) {
            for (let i = 0; i < initialEmails.length; i++) {
              try {
                await sendSingleEmail(initialEmails[i], campaign);
              } catch (err) {
                await handleSendError(initialEmails[i], err);
              }

              // 45-90s delay between cold initial emails (Google safety)
              if (i < initialEmails.length - 1) {
                await delay(45000, 90000);

                // Re-check business hours
                const recheck = isWithinSendWindow(timezone, false);
                if (!recheck.canSend) break;
              }
            }
          }
        }
      }

      // ===== PROCESS FOLLOW-UP EMAILS (batch) =====
      // Gate on subscription: getDailyLimit returns 0 when hasActiveSubscription() is false
      // (expired trial / lapsed / paused plan). Without this, follow-ups queued while the trial
      // was active would keep firing after it expires — sending on our system with no subscription.
      const { limit: followUpDailyLimit } = await getDailyLimit(campaign.user_id);
      if (followUpWindow.canSend && followUpDailyLimit > 0) {
        const { data: followUpEmails } = await supabase
          .from("emails")
          .select("*")
          .eq("campaign_id", campaign.id)
          .eq("status", "pending")
          .gt("sequence_step", 1)
          .or(`scheduled_at.is.null,scheduled_at.lte.${now}`)
          .order("sequence_step", { ascending: true })
          .limit(FOLLOW_UP_BATCH_SIZE);

        if (followUpEmails && followUpEmails.length > 0) {
          for (let i = 0; i < followUpEmails.length; i++) {
            const followUp = followUpEmails[i];

            // Skip if lead already replied
            if (followUp.lead_id) {
              const { data: replied } = await supabase
                .from("emails")
                .select("id")
                .eq("lead_id", followUp.lead_id)
                .eq("replied", true)
                .limit(1);

              if (replied && replied.length > 0) {
                await supabase
                  .from("emails")
                  .update({ status: "cancelled" })
                  .eq("id", followUp.id);
                logger.info({ emailId: followUp.id }, "Cancelled follow-up — lead already replied");
                continue;
              }
            }

            // Gate: previous step must exist and be "sent" before we send this follow-up
            if (followUp.lead_id) {
              const prevStep = followUp.sequence_step - 1;
              const { data: prevEmail } = await supabase
                .from("emails")
                .select("status, sent_at")
                .eq("campaign_id", campaign.id)
                .eq("lead_id", followUp.lead_id)
                .eq("sequence_step", prevStep)
                .single();

              if (!prevEmail || prevEmail.status !== "sent") {
                // Previous step failed or still pending — cancel this follow-up
                const reason = !prevEmail
                  ? "Cancelled: previous step not found"
                  : `Cancelled: step ${prevStep} status is ${prevEmail.status}`;
                await supabase
                  .from("emails")
                  .update({ status: "cancelled", error_log: reason })
                  .eq("id", followUp.id);
                logger.info({ emailId: followUp.id, reason }, "Cancelled follow-up — previous step not sent");
                continue;
              }

              // Gate: previous step must have been sent at least 2 days ago
              if (prevEmail.sent_at) {
                const sentAt = new Date(prevEmail.sent_at);
                const hoursSincePrev = (Date.now() - sentAt.getTime()) / (1000 * 60 * 60);
                if (hoursSincePrev < 48) {
                  // Not enough time since previous step — skip for now, don't cancel
                  logger.debug({ emailId: followUp.id, hoursSincePrev: Math.round(hoursSincePrev) }, "Skipping follow-up — too soon after previous step");
                  continue;
                }
              }
            }

            try {
              await sendSingleEmail(followUp, campaign);
            } catch (err) {
              await handleSendError(followUp, err);
              break; // Stop follow-up batch on error
            }

            // 20-30s delay between follow-ups (same thread, safer)
            if (i < followUpEmails.length - 1) {
              await delay(20000, 30000);

              // Re-check business hours
              const recheck = isWithinSendWindow(timezone, true);
              if (!recheck.canSend) break;
            }
          }
        }
      }

      // ===== CANCEL ORPHANED FOLLOW-UPS =====
      // If any initial emails failed permanently, cancel their pending follow-ups
      const { data: failedInitials } = await supabase
        .from("emails")
        .select("lead_id")
        .eq("campaign_id", campaign.id)
        .eq("sequence_step", 1)
        .eq("status", "failed");

      if (failedInitials && failedInitials.length > 0) {
        const failedLeadIds = failedInitials.map(e => e.lead_id).filter(Boolean);
        if (failedLeadIds.length > 0) {
          await supabase
            .from("emails")
            .update({ status: "cancelled", error_log: "Cancelled: initial email failed" })
            .eq("campaign_id", campaign.id)
            .eq("status", "pending")
            .gt("sequence_step", 1)
            .in("lead_id", failedLeadIds);
        }
      }

      // ===== CHECK IF CAMPAIGN IS DONE =====
      // Count both "pending" and in-flight "sending" so we never mark a campaign
      // complete while an email is mid-send.
      const { count: pendingCount } = await supabase
        .from("emails")
        .select("*", { count: "exact", head: true })
        .eq("campaign_id", campaign.id)
        .in("status", ["pending", "sending"]);

      if (pendingCount === 0) {
        // Check if any emails were actually sent successfully
        const { count: sentCount } = await supabase
          .from("emails")
          .select("*", { count: "exact", head: true })
          .eq("campaign_id", campaign.id)
          .eq("status", "sent");

        const finalStatus = (sentCount && sentCount > 0) ? "completed" : "failed";
        await supabase
          .from("campaigns")
          .update({ status: finalStatus })
          .eq("id", campaign.id);
        logger.info({ campaignId: campaign.id, status: finalStatus, sentCount }, `Campaign ${finalStatus}`);
      }
    }
  } catch (err) {
    logger.error({ err }, "Error processing email queue");
  } finally {
    // Stop the heartbeat before releasing the lock
    clearInterval(heartbeat);
    // Always release the lock so the next cycle can acquire it
    try {
      await supabase.rpc("release_job_lock", {
        p_lock_name: LOCK_NAME,
        p_locked_by: INSTANCE_ID,
      });
    } catch { /* lock auto-expires after 5 min if release fails */ }
  }
}

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startEmailQueue() {
  if (intervalId) {
    logger.info("Email queue already running");
    return;
  }
  logger.info("Email queue processor started (interval: 60s)");
  processEmailQueue();
  intervalId = setInterval(processEmailQueue, 60 * 1000);
}

export function stopEmailQueue() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info("Email queue processor stopped");
  }
}
