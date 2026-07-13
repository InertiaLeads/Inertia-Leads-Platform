import supabase from "./supabase";
import logger from "../utils/logger";
import { decrementLeadsFoundToday } from "./planLimits";
import { scrapeWebsite, generateEnrichmentSummary } from "./scraper";
import { scoreLead } from "./leadScoring";
import { discoverWebsite } from "./leadFinder";

/**
 * Enrich a batch of just-inserted leads in the background:
 *  - discover the business website (web search) when one isn't already known,
 *  - scrape the site for email / phone / business data,
 *  - score the lead and store enrichment data,
 *  - prune leads that end up with NO email AND NO phone (their daily slot is refunded).
 *
 * Shared by BOTH auto-find and CSV upload so the two paths enrich identically.
 * Self-contained (own try/catch) — intended to be run fire-and-forget via setImmediate.
 *
 * Note: CSV leads always carry an email (validated at upload), so they are never pruned here —
 * enrichment only ADDS a website + scraped data + score for them.
 */
export async function enrichLeadsInBackground(userId: string, leadIds: string[]): Promise<void> {
  if (!leadIds || leadIds.length === 0) return;

  try {
    const { data: leadsToScrape } = await supabase
      .from("leads")
      .select("id, website, email, phone, company, industry, campaign_id, enriched_data")
      .in("id", leadIds);

    if (!leadsToScrape) return;

    const leadsToDelete: { id: string; campaignId: string }[] = [];
    const SCRAPE_BATCH = 5;
    for (let i = 0; i < leadsToScrape.length; i += SCRAPE_BATCH) {
      const batch = leadsToScrape.slice(i, i + SCRAPE_BATCH);
      await Promise.all(batch.map(async (lead: any) => {
        try {
          let websiteUrl = lead.website;

          // If no website, try to discover one via web search
          if (!websiteUrl) {
            const discovered = await discoverWebsite(lead.company, lead.industry);
            if (discovered) {
              websiteUrl = discovered;
              await supabase.from("leads").update({ website: discovered }).eq("id", lead.id);
            }
          }

          if (!websiteUrl) {
            // Still no website — score based on what we know
            if (!lead.email && !lead.phone) {
              leadsToDelete.push({ id: lead.id, campaignId: lead.campaign_id });
            } else {
              const score = scoreLead({ company: lead.company });
              await supabase.from("leads").update({ score }).eq("id", lead.id);
            }
            return;
          }
          const websiteData = await scrapeWebsite(websiteUrl);
          if (!websiteData) {
            // Scrape failed but lead has contact info — still score it (no website data = high opportunity)
            if (lead.email || lead.phone) {
              const score = scoreLead({ website: websiteUrl, company: lead.company });
              await supabase.from("leads").update({ score }).eq("id", lead.id);
            } else {
              leadsToDelete.push({ id: lead.id, campaignId: lead.campaign_id });
            }
            return;
          }

          const enrichmentSummary = generateEnrichmentSummary(websiteData, lead.company);
          const score = scoreLead({
            website: websiteUrl,
            enriched_data: websiteData as any,
            company: lead.company,
          });

          const updateFields: Record<string, any> = {
            enriched_data: {
              ...websiteData,
              ...enrichmentSummary,
              // Industry priority: lead.industry (from niche search / CSV) > scraper detection
              industry: lead.industry || websiteData.industry || "Unknown",
              // Preserve Google rating/reviews from lead finder (not available from scraper)
              ...(lead.enriched_data?.googleRating !== undefined ? { googleRating: lead.enriched_data.googleRating } : {}),
              ...(lead.enriched_data?.googleReviewCount !== undefined ? { googleReviewCount: lead.enriched_data.googleReviewCount } : {}),
              ...(lead.enriched_data?.address ? { address: lead.enriched_data.address } : {}),
            },
            score,
            // Persist detected language from website content
            detected_language: websiteData.detectedLanguage || "eng",
          };

          // Priority 1: Email — if found on website, use it and ignore website phone
          const foundEmail = websiteData.emails && websiteData.emails.length > 0 ? websiteData.emails[0] : null;
          if (!lead.email && foundEmail) {
            updateFields.email = foundEmail;
            updateFields.contact_method = "email";
          } else if (lead.email) {
            // Already has email — keep it
            updateFields.contact_method = "email";
          } else {
            // Priority 2: No email anywhere — go for phone
            // Only add website phone if Serper didn't already provide one
            if (!lead.phone && websiteData.phones && websiteData.phones.length > 0) {
              updateFields.phone = websiteData.phones[0];
            }
            if (lead.phone || updateFields.phone) {
              updateFields.contact_method = "call";
            } else {
              // No email AND no phone — useless lead, mark for deletion
              leadsToDelete.push({ id: lead.id, campaignId: lead.campaign_id });
              return;
            }
          }

          if (Object.keys(updateFields).length > 0) {
            await supabase
              .from("leads")
              .update(updateFields)
              .eq("id", lead.id);
          }
        } catch (err) {
          logger.error({ leadId: lead.id, err }, "Background scrape failed for lead");
        }
      }));
    }

    // Delete useless leads (no email + no phone)
    if (leadsToDelete.length > 0) {
      const deleteIds = leadsToDelete.map(l => l.id);
      await supabase.from("leads").delete().in("id", deleteIds);

      // Update campaign totals with exact count from DB (avoids race conditions)
      const affectedCampaignIds = [...new Set(leadsToDelete.map(l => l.campaignId))];
      for (const cId of affectedCampaignIds) {
        const { count: actualCount } = await supabase
          .from("leads")
          .select("*", { count: "exact", head: true })
          .eq("campaign_id", cId);
        await supabase
          .from("campaigns")
          .update({ total_leads: actualCount ?? 0 })
          .eq("id", cId);
      }

      logger.info({ deletedCount: leadsToDelete.length }, "Removed useless leads (no email + no phone)");

      // Decrement daily + monthly counters so remaining slots stay accurate
      await decrementLeadsFoundToday(userId, leadsToDelete.length);
    }

    logger.info({ count: leadsToScrape.length, deleted: leadsToDelete.length }, "Background contact scrape completed");
  } catch (err) {
    logger.error({ err }, "Background contact scrape failed");
  }
}
