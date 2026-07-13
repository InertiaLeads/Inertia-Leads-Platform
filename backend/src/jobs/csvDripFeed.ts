import supabase from "../services/supabase";
import { checkDailyLeadFindLimit, incrementLeadsFoundToday, incrementLeadsFound } from "../services/planLimits";
import { enrichLeadsInBackground } from "../services/leadEnrichment";
import logger from "../utils/logger";
import crypto from "crypto";

// Distributed lock name — must match the pre-inserted row in job_locks table
const LOCK_NAME = "csv_drip_feed";
// Unique instance ID — identifies which process holds the lock
const INSTANCE_ID = `cdf_${crypto.randomBytes(4).toString("hex")}_${process.pid}`;

/**
 * CSV Drip-Feed Processor
 * 
 * Promotes "csv_queued" leads to "csv" daily, up to each user's remaining
 * daily limit. Uses the same timezone-aware monotonic counter as auto-find
 * so queued promotions + search + uploads all share the same daily pool.
 * 
 * Runs once every 60 minutes. Queued leads get priority — they promote
 * at midnight before the user does any manual search or upload.
 * 
 * Flow:
 * 1. Find all users who have csv_queued leads
 * 2. For each user, check remaining daily slots (timezone-aware counter)
 * 3. Promote up to remaining slots, increment daily + monthly counters
 * 4. Update queued_leads count on each campaign
 */

async function processCsvDripFeed() {
  // Acquire table-based distributed lock — if another instance holds it, skip this cycle
  // Lock auto-expires after 5 minutes (stale lock protection if process crashes)
  const { data: acquired } = await supabase.rpc("acquire_job_lock", {
    p_lock_name: LOCK_NAME,
    p_locked_by: INSTANCE_ID,
  });
  if (!acquired) {
    logger.debug("CSV drip-feed: another instance holds the lock, skipping cycle");
    return;
  }

  try {
    // Find distinct users who have queued CSV leads
    const { data: queuedLeads, error } = await supabase
      .from("leads")
      .select("user_id, campaign_id")
      .eq("source_type", "csv_queued")
      .limit(1000);

    if (error || !queuedLeads || queuedLeads.length === 0) return;

    // Get unique user+campaign pairs
    const userCampaigns = new Map<string, Set<string>>();
    for (const lead of queuedLeads) {
      if (!userCampaigns.has(lead.user_id)) {
        userCampaigns.set(lead.user_id, new Set());
      }
      if (lead.campaign_id) {
        userCampaigns.get(lead.user_id)!.add(lead.campaign_id);
      }
    }

    for (const [userId, campaignIds] of userCampaigns) {
      try {
        // Check remaining daily slots using timezone-aware monotonic counter
        const dailyCheck = await checkDailyLeadFindLimit(userId);
        let canPromote = dailyCheck.remaining;

        if (canPromote === 0) continue;

        let totalPromoted = 0;
        const promotedIds: string[] = [];

        // Promote queued leads across all campaigns for this user
        for (const campaignId of campaignIds) {
          if (canPromote <= 0) break;

          // Fetch queued leads for this campaign
          const { data: toPromote } = await supabase
            .from("leads")
            .select("id")
            .eq("user_id", userId)
            .eq("campaign_id", campaignId)
            .eq("source_type", "csv_queued")
            .order("created_at", { ascending: true })
            .limit(canPromote);

          if (!toPromote || toPromote.length === 0) continue;

          const ids = toPromote.map(l => l.id);

          // Promote: change source_type from csv_queued to csv
          const { error: updateError } = await supabase
            .from("leads")
            .update({ source_type: "csv" })
            .in("id", ids);

          if (!updateError) {
            const promoted = ids.length;
            canPromote -= promoted;
            totalPromoted += promoted;
            promotedIds.push(...ids);

            // Update queued_leads count on this campaign
            const { count: remainingQueued } = await supabase
              .from("leads")
              .select("*", { count: "exact", head: true })
              .eq("campaign_id", campaignId)
              .eq("source_type", "csv_queued");

            await supabase
              .from("campaigns")
              .update({ queued_leads: remainingQueued || 0 })
              .eq("id", campaignId);

            logger.info({
              userId,
              campaignId,
              promoted,
              remainingQueued: remainingQueued || 0,
              dailyLimit: dailyCheck.dailyLimit,
            }, "CSV drip-feed: promoted queued leads");
          }
        }

        // Increment daily + monthly counters for all promoted leads at once
        if (totalPromoted > 0) {
          await incrementLeadsFoundToday(userId, totalPromoted);
          await incrementLeadsFound(userId, totalPromoted);
          // Enrich the promoted leads (discover website + scrape + score), same as auto-find/upload.
          setImmediate(() => enrichLeadsInBackground(userId, promotedIds));
        }
      } catch (err) {
        logger.error({ userId, error: err instanceof Error ? err.message : err }, "CSV drip-feed error for user");
      }
    }
  } catch (err) {
    logger.error({ err }, "Error in CSV drip-feed processor");
  } finally {
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

export function startCsvDripFeed() {
  if (intervalId) {
    logger.info("CSV drip-feed already running");
    return;
  }
  logger.info("CSV drip-feed processor started (interval: 60min)");
  // Run once on startup, then every 60 minutes
  processCsvDripFeed();
  intervalId = setInterval(processCsvDripFeed, 60 * 60 * 1000);
}

export function stopCsvDripFeed() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info("CSV drip-feed processor stopped");
  }
}
