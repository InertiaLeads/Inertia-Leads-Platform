import { Router } from "express";
import multer from "multer";
import { authMiddleware, AuthenticatedRequest } from "../middleware/auth";
import { autoFindLimiter, enrichLimiter } from "../middleware/rateLimit";
import supabase from "../services/supabase";
import { parseCSV } from "../utils/csv";
import { findLeadsByNiche, formatLeadsForDB } from "../services/leadFinder";
import { checkLeadFindLimit, incrementLeadsFound, incrementLeadsFoundToday, checkDailyLeadFindLimit, getMaxEnrichBatchSize, getUserPlan, getFeatureAccess, PLAN_CONFIGS } from "../services/planLimits";
import { enrichLeadsInBackground } from "../services/leadEnrichment";
import logger from "../utils/logger";

const router = Router();

// Max CSV file size: 2MB
const MAX_CSV_SIZE = 2 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_CSV_SIZE },
});

// POST /api/leads/upload — Upload CSV and create leads + campaign
router.post("/upload", authMiddleware, upload.single("file"), async (req: AuthenticatedRequest, res) => {
  try {
    const file = req.file;
    const campaignName = req.body.campaignName;
    const VALID_TIMEZONES = ["US_EAST", "US_CENTRAL", "US_MOUNTAIN", "US_WEST", "US_ALASKA", "US_HAWAII", "CA_ATLANTIC", "CA_NEWFOUNDLAND", "UK", "EU_CENTRAL", "EU_EAST", "UAE", "ARABIA", "INDIA", "SINGAPORE", "PHILIPPINES", "JAPAN", "AU_WEST", "AU_CENTRAL", "AU_EAST", "NZ", "BRAZIL", "SOUTH_AFRICA"];
    const sendTimezone = VALID_TIMEZONES.includes(req.body.sendTimezone) ? req.body.sendTimezone : "US_EAST";

    if (!file || !campaignName) {
      res.status(400).json({ error: "File and campaign name are required" });
      return;
    }

    // Validate file type
    if (!file.originalname.endsWith(".csv")) {
      res.status(400).json({ error: "Only CSV files are allowed" });
      return;
    }

    // File size already enforced by multer (2MB max)

    const text = file.buffer.toString("utf-8");
    const leads = parseCSV(text);

    if (leads.length === 0) {
      res.status(400).json({ error: "No valid leads found in CSV" });
      return;
    }

    // Validate required CSV columns: email, company
    const requiredColumns = ["email", "company"];
    const headers = Object.keys(leads[0]);
    const missingColumns = requiredColumns.filter((col) => !headers.includes(col));
    if (missingColumns.length > 0) {
      res.status(400).json({
        error: `Missing required CSV columns: ${missingColumns.join(", ")}. Expected: email, company (optional: name, website, industry)`,
      });
      return;
    }

    // Feature gate: CSV upload is a Growth/Agency feature (unlocked during the trial).
    // Enforced on the backend too — the frontend gate alone is bypassable by a Starter user.
    const uploaderPlan = await getUserPlan(req.userId!);
    if (!getFeatureAccess(uploaderPlan.plan, uploaderPlan.isOnTrial).csvUpload) {
      res.status(403).json({
        error: "CSV upload is available on the Growth and Agency plans. Upgrade to upload your own lead lists.",
      });
      return;
    }

    // Skip rows with a blank or malformed email — CSV leads aren't enrichment-rescued, so a row
    // with no valid email is just a dead, uncontactable lead. Only keep well-formed emails.
    const emailRegex = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
    const validLeads = leads.filter((l) => emailRegex.test((l.email || "").trim().toLowerCase()));
    if (validLeads.length === 0) {
      res.status(400).json({
        error: "No rows with a valid email address were found in your CSV. Make sure the 'email' column is filled in.",
      });
      return;
    }

    // Check daily lead find limit (uses monotonic counter)
    // If fully used (e.g. 200/200), CSV upload is disabled entirely
    const dailyCheck = await checkDailyLeadFindLimit(req.userId!);
    if (!dailyCheck.allowed) {
      res.status(403).json({
        error: `Daily limit reached (${dailyCheck.usedToday}/${dailyCheck.dailyLimit}). CSV upload is disabled until tomorrow.`,
        usedToday: dailyCheck.usedToday,
        dailyLimit: dailyCheck.dailyLimit,
        remaining: 0,
        plan: dailyCheck.plan,
      });
      return;
    }

    // Cap total CSV leads to plan's max per upload (Starter: 50, Growth: 100, Agency: 200)
    // Leads beyond this cap are dropped — user must re-upload tomorrow (duplicates auto-skipped)
    const config = PLAN_CONFIGS[dailyCheck.plan];
    const maxUpload = config.maxDailyEmails;
    const cappedLeads = validLeads.slice(0, maxUpload);

    // Split: today's batch (remaining daily slots) and queued (rest up to plan cap)
    const remaining = dailyCheck.remaining;
    const todayLeads = cappedLeads.slice(0, remaining);
    const queuedLeads = cappedLeads.slice(remaining);

    // Insert today's leads first, skipping duplicates (unique constraint on website/company+phone)
    let insertedTodayCount = 0;
    if (todayLeads.length > 0) {
      const todayLeadsToInsert = todayLeads.map((lead) => ({
        campaign_id: "__CAMPAIGN_ID__", // placeholder, set after campaign creation
        user_id: req.userId,
        name: lead.name || "",
        email: lead.email || "",
        company: lead.company || "",
        website: lead.website || "",
        industry: lead.industry || "",
        source_type: "csv" as const,
      }));

      // Try inserting one-by-one to skip duplicates without failing the whole batch
      for (const lead of todayLeadsToInsert) {
        insertedTodayCount++; // count attempted (we'll create campaign with this)
      }
    }

    let insertedQueuedCount = 0;
    const queuedLeadsToInsert = queuedLeads.map((lead) => ({
      campaign_id: "__CAMPAIGN_ID__",
      user_id: req.userId,
      name: lead.name || "",
      email: lead.email || "",
      company: lead.company || "",
      website: lead.website || "",
      industry: lead.industry || "",
      source_type: "csv_queued" as const,
    }));
    insertedQueuedCount = queuedLeadsToInsert.length;

    // Create campaign AFTER we know the counts
    const { data: campaign, error: campaignError } = await supabase
      .from("campaigns")
      .insert({
        user_id: req.userId,
        name: campaignName,
        status: "draft",
        total_leads: cappedLeads.length,
        queued_leads: queuedLeads.length,
        send_timezone: sendTimezone,
      })
      .select()
      .single();

    if (campaignError) {
      res.status(500).json({ error: "Failed to create campaign" });
      return;
    }

    // Insert today's leads with duplicate skipping
    // Uses batch insert (chunks of 50) for speed. If a batch fails due to
    // a unique constraint (duplicate), falls back to individual inserts for that chunk.
    let actualInsertedToday = 0;
    const insertedTodayIds: string[] = [];
    if (todayLeads.length > 0) {
      const todayLeadsToInsert = todayLeads.map((lead) => ({
        campaign_id: campaign.id,
        user_id: req.userId,
        name: lead.name || "",
        email: (lead.email || "").trim(),
        company: lead.company || "",
        // Normalize website (strip trailing slashes) so it matches the dedup unique index,
        // consistent with the auto-find path — otherwise "site.com/" vs "site.com" duplicate.
        website: (lead.website || "").trim().replace(/\/+$/, ""),
        industry: lead.industry || "",
        source_type: "csv",
      }));

      const BATCH_SIZE = 50;
      for (let i = 0; i < todayLeadsToInsert.length; i += BATCH_SIZE) {
        const batch = todayLeadsToInsert.slice(i, i + BATCH_SIZE);
        const { data: inserted, error: batchErr } = await supabase
          .from("leads")
          .insert(batch)
          .select("id");

        if (!batchErr && inserted) {
          // Entire batch succeeded — no duplicates in this chunk
          actualInsertedToday += inserted.length;
          insertedTodayIds.push(...inserted.map((r: any) => r.id));
        } else {
          // Batch had duplicates — fall back to individual inserts for this chunk only
          for (const lead of batch) {
            const { data: one, error: leadErr } = await supabase.from("leads").insert(lead).select("id").single();
            if (!leadErr && one) {
              actualInsertedToday++;
              insertedTodayIds.push(one.id);
            }
          }
        }
      }

      // Track against daily + monthly limits (only count successful inserts)
      if (actualInsertedToday > 0) {
        await incrementLeadsFound(req.userId!, actualInsertedToday);
        await incrementLeadsFoundToday(req.userId!, actualInsertedToday);
      }
    }

    // Insert queued leads (same batch approach)
    let actualInsertedQueued = 0;
    if (queuedLeads.length > 0) {
      const queuedToInsert = queuedLeads.map((lead) => ({
        campaign_id: campaign.id,
        user_id: req.userId,
        name: lead.name || "",
        email: (lead.email || "").trim(),
        company: lead.company || "",
        website: (lead.website || "").trim().replace(/\/+$/, ""),
        industry: lead.industry || "",
        source_type: "csv_queued",
      }));

      const BATCH_SIZE = 50;
      for (let i = 0; i < queuedToInsert.length; i += BATCH_SIZE) {
        const batch = queuedToInsert.slice(i, i + BATCH_SIZE);
        const { data: inserted, error: batchErr } = await supabase
          .from("leads")
          .insert(batch)
          .select("id");

        if (!batchErr && inserted) {
          actualInsertedQueued += inserted.length;
        } else {
          for (const lead of batch) {
            const { error: leadErr } = await supabase.from("leads").insert(lead);
            if (!leadErr) actualInsertedQueued++;
          }
        }
      }
    }

    // Update campaign with actual counts (after duplicate skipping)
    const totalActual = actualInsertedToday + actualInsertedQueued;
    if (totalActual !== cappedLeads.length || actualInsertedQueued !== queuedLeads.length) {
      await supabase
        .from("campaigns")
        .update({
          total_leads: totalActual,
          queued_leads: actualInsertedQueued,
        })
        .eq("id", campaign.id);
    }

    // If nothing was inserted at all, clean up the empty campaign
    if (totalActual === 0) {
      await supabase
        .from("campaigns")
        .delete()
        .eq("id", campaign.id);

      res.status(400).json({
        error: "All leads in your CSV already exist in your account. Try a different CSV.",
      });
      return;
    }

    // Enrich the active (today's) CSV leads in the background — discover website, scrape business
    // data, and score — same pipeline as auto-find. (CSV leads always have an email, so none are
    // pruned.) Queued leads are enriched later, when the drip-feed promotes them.
    if (insertedTodayIds.length > 0) {
      setImmediate(() => enrichLeadsInBackground(req.userId!, insertedTodayIds));
    }

    const skippedFromCsv = leads.length - cappedLeads.length;
    const duplicatesSkipped = cappedLeads.length - totalActual;

    res.json({
      message: actualInsertedQueued > 0
        ? `Uploaded ${totalActual} leads. ${actualInsertedToday} ready now, ${actualInsertedQueued} queued for upcoming days.`
        : `Uploaded ${actualInsertedToday} leads successfully.`,
      count: totalActual,
      readyNow: actualInsertedToday,
      queued: actualInsertedQueued,
      skipped: skippedFromCsv,
      duplicatesSkipped,
      dailyLimit: dailyCheck.dailyLimit,
      remaining: Math.max(0, remaining - actualInsertedToday),
      campaignId: campaign.id,
    });
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/leads — List leads for user (paginated)
router.get("/", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data: leads, error, count } = await supabase
      .from("leads")
      .select("*", { count: "exact" })
      .eq("user_id", req.userId)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) {
      res.status(500).json({ error: "Failed to fetch leads" });
      return;
    }

    res.json({ leads, total: count || 0, page, limit });
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/leads/auto-find — Find leads automatically by niche and location
router.post("/auto-find", authMiddleware, autoFindLimiter, async (req: AuthenticatedRequest, res) => {
  try {
    const { niche, location, limit } = req.body;

    if (!niche || !location) {
      res.status(400).json({ error: "Niche and location are required" });
      return;
    }

    // Check plan-based monthly lead find limit
    const leadFindCheck = await checkLeadFindLimit(req.userId!);
    if (!leadFindCheck.allowed) {
      res.status(403).json({
        error: `Monthly lead find limit reached (${leadFindCheck.used}/${leadFindCheck.limit} on ${leadFindCheck.plan} plan). Upgrade your plan for more leads.`,
        used: leadFindCheck.used,
        limit: leadFindCheck.limit,
        plan: leadFindCheck.plan,
      });
      return;
    }

    // Check plan-based DAILY lead find limit (Starter: 50/day, Growth: 100/day, Agency: 200/day)
    const dailyCheck = await checkDailyLeadFindLimit(req.userId!);
    if (!dailyCheck.allowed) {
      res.status(403).json({
        error: `Daily lead find limit reached (${dailyCheck.usedToday}/${dailyCheck.dailyLimit} on ${dailyCheck.plan} plan). Try again tomorrow.`,
        usedToday: dailyCheck.usedToday,
        dailyLimit: dailyCheck.dailyLimit,
        remaining: 0,
        plan: dailyCheck.plan,
      });
      return;
    }

    // Cap search to remaining daily slots (not more than what's left for today)
    let validatedLimit = dailyCheck.remaining;
    if (limit !== undefined) {
      const parsedLimit = parseInt(String(limit));
      if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > dailyCheck.remaining) {
        res.status(400).json({
          error: `Lead limit must be between 1 and ${dailyCheck.remaining} (your remaining daily cap). You've found ${dailyCheck.usedToday}/${dailyCheck.dailyLimit} leads today.`,
        });
        return;
      }
      validatedLimit = parsedLimit;
    }

    // Create lead source record
    const { data: source, error: sourceError } = await supabase
      .from("lead_sources")
      .insert({
        user_id: req.userId,
        niche,
        location,
        status: "running",
      })
      .select()
      .single();

    if (sourceError || !source?.id) {
      res.status(500).json({ error: "Failed to create lead source" });
      return;
    }

    // Find leads using the lead finder service.
    // findLeadsByNiche THROWS on a real provider failure (after retries) and returns [] only when
    // the search genuinely found nothing — so we can tell "failed" apart from "no results".
    let foundLeads;
    try {
      foundLeads = await findLeadsByNiche({
        niche,
        location,
        limit: validatedLimit,
      });
    } catch (findErr) {
      // Real search failure — mark the source FAILED (not "completed · 0 leads") and tell the user
      // to retry, instead of silently pretending the search found nothing.
      await supabase
        .from("lead_sources")
        .update({ status: "failed" })
        .eq("id", source.id);
      logger.error(
        { err: findErr instanceof Error ? findErr.message : findErr, niche, location },
        "Lead search failed"
      );
      res.status(503).json({
        error: findErr instanceof Error ? findErr.message : "Search failed. Please try again.",
        source_id: source.id,
        failed: true,
      });
      return;
    }

    if (foundLeads.length === 0) {
      // Genuine "no results" — search succeeded but matched nothing. Mark completed and guide the user.
      await supabase
        .from("lead_sources")
        .update({ status: "completed" })
        .eq("id", source.id);

      res.json({
        message: `No businesses found for "${niche}" in "${location}". Try a specific city (e.g. "Los Angeles") or a different niche.`,
        source_id: source.id,
        count: 0,
      });
      return;
    }

    // Create a campaign for the found leads
    const campaignName = `${niche} in ${location}`;
    const { data: campaign, error: campaignError } = await supabase
      .from("campaigns")
      .insert({
        user_id: req.userId,
        name: campaignName,
        status: "draft",
        total_leads: foundLeads.length,
      })
      .select()
      .single();

    if (campaignError || !campaign) {
      await supabase
        .from("lead_sources")
        .update({ status: "completed" })
        .eq("id", source.id);
      res.status(500).json({ error: "Failed to create campaign for found leads" });
      return;
    }

    // Format and insert leads with campaign_id
    if (!req.userId) {
      res.status(401).json({ error: "User not authenticated" });
      return;
    }
    const formattedLeads = formatLeadsForDB(foundLeads, req.userId, source.id).map(
      (lead) => ({ ...lead, campaign_id: campaign.id, source_type: "auto_find" })
    );

    // Deduplicate: filter out leads whose website or company+phone already exist for this user
    // Also normalize website URLs in the leads themselves to match the DB unique index
    let leadsToInsert = formattedLeads.map((lead) => ({
      ...lead,
      website: lead.website ? lead.website.replace(/\/+$/, "") : "",
    }));

    if (leadsToInsert.length > 0) {
      // Deduplicate within the batch itself (Serper can return duplicates across pages)
      const seenWebsites = new Set<string>();
      const seenCompanyPhone = new Set<string>();
      const seenCompanyAddress = new Set<string>();
      leadsToInsert = leadsToInsert.filter((lead) => {
        const normalizedWebsite = lead.website?.toLowerCase();
        if (normalizedWebsite) {
          if (seenWebsites.has(normalizedWebsite)) return false;
          seenWebsites.add(normalizedWebsite);
        }
        if (lead.company && lead.phone) {
          const key = `${lead.company.toLowerCase()}|${lead.phone.toLowerCase()}`;
          if (seenCompanyPhone.has(key)) return false;
          seenCompanyPhone.add(key);
        }
        // Dedup by company + address — catches the same business when it has no website/phone yet
        // (Serper omits contact info for many listings, so website/phone keys can't catch those).
        const addr = ((lead as any).enriched_data?.address || "").toLowerCase().trim();
        if (lead.company && addr) {
          const key = `${lead.company.toLowerCase()}|${addr}`;
          if (seenCompanyAddress.has(key)) return false;
          seenCompanyAddress.add(key);
        }
        return true;
      });

      // Get existing websites and company+phone/address combos for this user
      const { data: existingLeads } = await supabase
        .from("leads")
        .select("website, company, phone, enriched_data")
        .eq("user_id", req.userId);

      if (existingLeads && existingLeads.length > 0) {
        const existingWebsites = new Set(
          existingLeads
            .map((l: any) => l.website?.toLowerCase().replace(/\/+$/, ""))
            .filter(Boolean)
        );
        const existingCompanyPhone = new Set(
          existingLeads
            .map((l: any) => `${l.company?.toLowerCase()}|${l.phone?.toLowerCase()}`)
            .filter((v: string) => v !== "|")
        );
        // company + address of already-saved leads — catches re-adding a business that was found
        // before as name-only (no website/phone) and later enriched.
        const existingCompanyAddress = new Set(
          existingLeads
            .map((l: any) => {
              const addr = (l.enriched_data?.address || "").toLowerCase().trim();
              return l.company && addr ? `${l.company.toLowerCase()}|${addr}` : null;
            })
            .filter(Boolean)
        );

        leadsToInsert = leadsToInsert.filter((lead) => {
          // Check website match
          const normalizedWebsite = lead.website?.toLowerCase();
          if (normalizedWebsite && existingWebsites.has(normalizedWebsite)) {
            return false;
          }
          // Check company+phone match (for leads without websites)
          if (lead.company && lead.phone) {
            const key = `${lead.company.toLowerCase()}|${lead.phone.toLowerCase()}`;
            if (existingCompanyPhone.has(key)) {
              return false;
            }
          }
          // Check company+address match (for name-only leads with no website/phone yet)
          const addr = ((lead as any).enriched_data?.address || "").toLowerCase().trim();
          if (lead.company && addr) {
            const key = `${lead.company.toLowerCase()}|${addr}`;
            if (existingCompanyAddress.has(key)) {
              return false;
            }
          }
          return true;
        });
      }
    }

    // Re-check daily remaining (in case multiple searches happened close together)
    // and cap leadsToInsert to the actual remaining daily allowance
    const dailyRecheck = await checkDailyLeadFindLimit(req.userId!);
    if (leadsToInsert.length > dailyRecheck.remaining) {
      leadsToInsert = leadsToInsert.slice(0, dailyRecheck.remaining);
    }

    if (leadsToInsert.length === 0) {
      await supabase
        .from("lead_sources")
        .update({ status: "completed" })
        .eq("id", source.id);

      // Update campaign total
      await supabase
        .from("campaigns")
        .update({ total_leads: 0 })
        .eq("id", campaign.id);

      res.json({
        message: "All found leads already exist in your account. Try a different niche or location.",
        source_id: source.id,
        campaign_id: campaign.id,
        campaign_name: campaignName,
        count: 0,
        duplicatesSkipped: formattedLeads.length,
      });
      return;
    }

    const { data: insertedLeads, error: leadsError } = await supabase
      .from("leads")
      .insert(leadsToInsert)
      .select("id");

    const insertedCount = insertedLeads?.length ?? leadsToInsert.length;

    if (leadsError) {
      logger.error({ leadsError, leadsToInsertCount: leadsToInsert.length }, "Failed to insert found leads");
      await supabase
        .from("lead_sources")
        .update({ status: "completed" })
        .eq("id", source.id);

      res.status(500).json({ error: "Failed to insert found leads", detail: leadsError.message });
      return;
    }

    // Update campaign total to actual inserted count (excluding duplicates)
    await supabase
      .from("campaigns")
      .update({ total_leads: insertedCount })
      .eq("id", campaign.id);

    // Update source status to completed
    await supabase
      .from("lead_sources")
      .update({ status: "completed" })
      .eq("id", source.id);

    // Track leads found against monthly and daily plan limits
    await incrementLeadsFound(req.userId!, insertedCount);
    await incrementLeadsFoundToday(req.userId!, insertedCount);

    // Get updated daily usage for response
    const dailyFinal = await checkDailyLeadFindLimit(req.userId!);

    // Auto-scrape websites in background to fill in emails & phones
    // This runs after the response is sent so the user doesn't wait
    if (insertedLeads && insertedLeads.length > 0) {
      const leadIdsToScrape = insertedLeads.map((l: any) => l.id);
      // Enrich in the background (after the response is sent) so the user doesn't wait.
      setImmediate(() => enrichLeadsInBackground(req.userId!, leadIdsToScrape));
    }

    res.json({
      message: "Leads found and campaign created successfully",
      source_id: source.id,
      campaign_id: campaign.id,
      campaign_name: campaignName,
      count: insertedCount,
      duplicatesSkipped: formattedLeads.length - insertedCount,
      dailyUsed: dailyFinal.usedToday,
      dailyLimit: dailyFinal.dailyLimit,
      dailyRemaining: dailyFinal.remaining,
    });
  } catch (error) {
    logger.error({ error }, "AutoFind error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/leads/enrich — Enrich a lead with website data and scoring
router.post("/enrich", authMiddleware, enrichLimiter, async (req: AuthenticatedRequest, res) => {
  try {
    const { leadIds } = req.body;

    if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
      res.status(400).json({ error: "Lead IDs array is required" });
      return;
    }

    // SECURITY: Check subscription access before allowing enrichment
    const { checkSubscriptionAccess } = await import("../services/planLimits");
    const accessCheck = await checkSubscriptionAccess(req.userId!);
    if (!accessCheck.hasAccess) {
      res.status(403).json({ error: accessCheck.reason });
      return;
    }

    // Cap batch size to plan limit
    const maxBatch = await getMaxEnrichBatchSize(req.userId!);
    if (leadIds.length > maxBatch) {
      res.status(400).json({
        error: `Enrichment batch size exceeds plan limit. Maximum ${maxBatch} leads per request on your plan.`,
        maxBatchSize: maxBatch,
        requested: leadIds.length,
      });
      return;
    }

    const { scrapeWebsite, generateEnrichmentSummary } = await import("../services/scraper");
    const { scoreLead } = await import("../services/leadScoring");

    // Fetch leads
    const { data: leads, error: leadsError } = await supabase
      .from("leads")
      .select("*")
      .eq("user_id", req.userId)
      .in("id", leadIds);

    if (leadsError || !leads || leads.length === 0) {
      res.status(404).json({ error: "No leads found" });
      return;
    }

    // Enrich leads in parallel batches of 5
    const ENRICH_BATCH_SIZE = 5;
    const enrichedLeads: { id: string; score: number; summary: string }[] = [];

    for (let i = 0; i < leads.length; i += ENRICH_BATCH_SIZE) {
      const batch = leads.slice(i, i + ENRICH_BATCH_SIZE);
      const batchResults = await Promise.all(batch.map(async (lead) => {
        try {
          let websiteData = null;
          let websiteUrl = lead.website;

          // If no website, try to discover one via web search
          if (!websiteUrl) {
            const { discoverWebsite } = await import("../services/leadFinder");
            const discovered = await discoverWebsite(lead.company, lead.industry);
            if (discovered) {
              websiteUrl = discovered;
              // Save discovered website to the lead
              await supabase.from("leads").update({ website: discovered }).eq("id", lead.id).eq("user_id", req.userId);
            }
          }

          if (websiteUrl) {
            websiteData = await scrapeWebsite(websiteUrl);
          }

          const enrichmentSummary = generateEnrichmentSummary(
            websiteData,
            lead.company
          );

          const score = scoreLead({
            website: lead.website,
            enriched_data: {
              ...websiteData as any,
            },
            company: lead.company,
          });

          const updateFields: Record<string, any> = {
            enriched_data: {
              ...websiteData,
              ...enrichmentSummary,
              // Industry priority: lead.industry (from niche search / CSV) > scraper detection
              industry: lead.industry || websiteData?.industry || "Unknown",
              // Preserve Google rating/reviews from lead finder (not available from scraper)
              ...(lead.enriched_data?.googleRating !== undefined ? { googleRating: lead.enriched_data.googleRating } : {}),
              ...(lead.enriched_data?.googleReviewCount !== undefined ? { googleReviewCount: lead.enriched_data.googleReviewCount } : {}),
              ...(lead.enriched_data?.address ? { address: lead.enriched_data.address } : {}),
            },
            score,
            // Persist detected language from website content
            detected_language: websiteData?.detectedLanguage || "eng",
          };

          // Priority 1: Email — if found on website, use it and ignore website phone
          const foundEmail = websiteData?.emails && websiteData.emails.length > 0 ? websiteData.emails[0] : null;
          if (!lead.email && foundEmail) {
            updateFields.email = foundEmail;
            updateFields.contact_method = "email";
          } else if (lead.email) {
            updateFields.contact_method = "email";
          } else {
            // Priority 2: No email anywhere — go for phone
            // Only add website phone if Serper didn't already provide one
            if (!lead.phone && websiteData?.phones && websiteData.phones.length > 0) {
              updateFields.phone = websiteData.phones[0];
            }
            if (lead.phone || updateFields.phone) {
              updateFields.contact_method = "call";
            } else {
              // No email AND no phone — useless lead, delete it
              await supabase.from("leads").delete().eq("id", lead.id).eq("user_id", req.userId);
              // Decrement campaign total
              if (lead.campaign_id) {
                const { data: camp } = await supabase.from("campaigns").select("total_leads").eq("id", lead.campaign_id).single();
                if (camp) {
                  await supabase.from("campaigns").update({ total_leads: Math.max(0, (camp.total_leads || 0) - 1) }).eq("id", lead.campaign_id);
                }
              }
              logger.info({ leadId: lead.id }, "Removed useless lead during enrichment (no email + no phone)");
              return null;
            }
          }

          let { error: updateError } = await supabase
            .from("leads")
            .update(updateFields)
            .eq("id", lead.id)
            .eq("user_id", req.userId);

          // If update failed (e.g. detected_language column missing), retry without it
          if (updateError) {
            logger.warn({ leadId: lead.id, error: updateError.message }, "Enrichment update failed, retrying without detected_language");
            const { detected_language, ...fieldsWithoutLang } = updateFields;
            const retry = await supabase
              .from("leads")
              .update(fieldsWithoutLang)
              .eq("id", lead.id)
              .eq("user_id", req.userId);
            updateError = retry.error;
          }

          if (!updateError) {
            return {
              id: lead.id,
              score,
              summary: enrichmentSummary.summary,
            };
          }
          logger.error({ leadId: lead.id, error: updateError.message }, "Failed to update lead during enrichment");
        } catch (error) {
          logger.error({ leadId: lead.id, error }, "Error enriching lead");
        }
        return null;
      }));

      for (const r of batchResults) {
        if (r) enrichedLeads.push(r);
      }
    }

    res.json({
      message: "Leads enriched successfully",
      count: enrichedLeads.length,
      leads: enrichedLeads,
    });
  } catch (error) {
    logger.error({ error }, "Enrich error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/leads/sources — List all lead sources for user (with campaign info)
router.get("/sources", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    // Fetch all lead sources for this user
    const { data: sources, error: sourcesError } = await supabase
      .from("lead_sources")
      .select("*")
      .eq("user_id", req.userId)
      .order("created_at", { ascending: false });

    if (sourcesError) {
      res.status(500).json({ error: "Failed to fetch lead sources" });
      return;
    }

    if (!sources || sources.length === 0) {
      res.json({ sources: [] });
      return;
    }

    // For each source, find the campaign and lead count
    const enrichedSources = await Promise.all(
      sources.map(async (source) => {
        // Find campaign that matches this source's niche+location pattern
        const campaignName = `${source.niche} in ${source.location}`;
        const { data: campaign } = await supabase
          .from("campaigns")
          .select("id, name, total_leads")
          .eq("user_id", req.userId)
          .eq("name", campaignName)
          .order("created_at", { ascending: false })
          .limit(1)
          .single();

        // Count leads from this source
        const { count: leadsCount } = await supabase
          .from("leads")
          .select("*", { count: "exact", head: true })
          .eq("source_id", source.id)
          .eq("user_id", req.userId);

        return {
          id: source.id,
          niche: source.niche,
          location: source.location,
          status: source.status,
          created_at: source.created_at,
          leadsCount: leadsCount || campaign?.total_leads || 0,
          campaignId: campaign?.id || null,
          campaignName: campaign?.name || null,
        };
      })
    );

    res.json({ sources: enrichedSources });
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
