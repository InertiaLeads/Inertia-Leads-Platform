import { Router } from "express";
import crypto from "crypto";
import { authMiddleware, AuthenticatedRequest } from "../middleware/auth";
import supabase from "../services/supabase";
import { schedulePageSpeedInBackground, isPageSpeedInFlight } from "../services/pageSpeed";
import { mergeEnrichedData } from "../services/enrichedData";
import { getUserPlan, getFeatureAccess, checkSubscriptionAccess } from "../services/planLimits";
import logger from "../utils/logger";

const router = Router();

// Cache for the benchmark sample set. The public audit view computes an "industry
// average health" comparison from up to 5000 leads; without this cache that scan runs
// on EVERY page view (a cost/DoS vector on an unauthenticated endpoint). Refreshes
// hourly and is per-instance (fine at a single Railway replica).
let benchmarkRowsCache: { rows: { id: string; industry: string | null; score: number | null }[]; expiresAt: number } | null = null;
const BENCHMARK_CACHE_TTL = 60 * 60 * 1000; // 1 hour

// ---------------------------------------------------------------------------
// Local market comparison
// ---------------------------------------------------------------------------
// The old "average business" benchmark averaged our own opportunity scores across every
// prospect in the database — a set selected BECAUSE those businesses looked weak — and
// presented it as an industry average. This replaces it with something a reader can check:
// the Google review counts and ratings of the other businesses in the SAME trade and the
// SAME city, taken from the search that found them (lead_sources.niche + location).
//
// Every number published here originates with Google, and the peers are the prospect's real
// local competitors. Only aggregates are exposed — never another business's name.
type LocalMarket = {
  niche: string;
  location: string;
  peerCount: number;
  avgReviews: number;
  avgRating: number | null;
  topReviews: number;
  aheadOfYou: number;
};

const MIN_PEERS = 5;                       // below this the average is noise, so we publish nothing
const LOCAL_MARKET_CACHE_TTL = 60 * 60 * 1000;

// The cache holds the raw per-peer review counts, not just the averages. `aheadOfYou` depends
// on THIS business's own count, so it has to be recomputed per lead — and it must be an exact
// count of peers, never derived from the average.
const localMarketCache = new Map<
  string,
  { niche: string; location: string; reviews: number[]; ratings: number[]; expiresAt: number } | { empty: true; expiresAt: number }
>();

async function getLocalMarket(
  sourceId: string | null,
  leadId: string,
  myReviews: number | null
): Promise<LocalMarket | null> {
  if (!sourceId) return null;
  try {
    const { data: source } = await supabase
      .from("lead_sources")
      .select("niche, location")
      .eq("id", sourceId)
      .maybeSingle();
    if (!source?.niche || !source?.location) return null;

    const niche = String(source.niche).trim();
    const location = String(source.location).trim();
    const marketKey = `${niche.toLowerCase()}|${location.toLowerCase()}`;

    let entry = localMarketCache.get(marketKey);
    if (entry && entry.expiresAt <= Date.now()) entry = undefined;

    if (!entry) {
      // Every search anyone has run for this trade in this city — the same niche/location
      // pair, not just this user's own run, so the sample is large enough to mean something.
      const { data: sameSearches } = await supabase
        .from("lead_sources")
        .select("id")
        .ilike("niche", niche)
        .ilike("location", location)
        .limit(200);

      const sourceIds = (sameSearches || []).map((s) => s.id);
      if (sourceIds.length === 0) return null;

      const { data: peerLeads } = await supabase
        .from("leads")
        .select("id, enriched_data")
        .in("source_id", sourceIds)
        .limit(1000);

      const reviews: number[] = [];
      const ratings: number[] = [];
      for (const r of peerLeads || []) {
        if (r.id === leadId) continue;               // never compare a business to itself
        const rc = Number((r.enriched_data as any)?.googleReviewCount);
        const rt = Number((r.enriched_data as any)?.googleRating);
        if (Number.isFinite(rc)) reviews.push(rc);
        if (Number.isFinite(rt) && rt > 0) ratings.push(rt);
      }

      entry =
        reviews.length < MIN_PEERS
          ? { empty: true, expiresAt: Date.now() + LOCAL_MARKET_CACHE_TTL }
          : { niche, location, reviews, ratings, expiresAt: Date.now() + LOCAL_MARKET_CACHE_TTL };
      localMarketCache.set(marketKey, entry);
      // Bound the cache — one entry per niche/city pair the instance has served.
      if (localMarketCache.size > 500) {
        for (const [k, v] of localMarketCache) {
          if (v.expiresAt <= Date.now()) localMarketCache.delete(k);
        }
      }
    }

    if ("empty" in entry) return null;

    const { reviews, ratings } = entry;
    return {
      niche: entry.niche,
      location: entry.location,
      peerCount: reviews.length,
      avgReviews: Math.round(reviews.reduce((s, n) => s + n, 0) / reviews.length),
      avgRating: ratings.length
        ? Math.round((ratings.reduce((s, n) => s + n, 0) / ratings.length) * 10) / 10
        : null,
      topReviews: Math.max(...reviews),
      // Exact count, recomputed per lead from the cached raw numbers.
      aheadOfYou:
        myReviews !== null && Number.isFinite(myReviews)
          ? reviews.filter((n) => n > (myReviews as number)).length
          : 0,
    };
  } catch (err) {
    logger.warn({ err, sourceId }, "Local market comparison failed (non-fatal)");
    return null;
  }
}

// POST /api/audit/generate — Generate an audit report token for a lead
// Requires auth — only the lead owner can generate audit links
router.post("/generate", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { leadId } = req.body;

    if (!leadId) {
      res.status(400).json({ error: "Lead ID is required" });
      return;
    }

    // SECURITY: Subscription access gate — must pass before generating a report.
    // The feature-flag check below stays "growth: true" after a trial lapses (the
    // plan column never changes), so without this an expired-trial user could still
    // generate audits. This closes the day-8 lock hole.
    const access = await checkSubscriptionAccess(req.userId!);
    if (!access.hasAccess) {
      res.status(403).json({ error: access.reason });
      return;
    }

    // Check if user has audit report access (trial users get full access, Starter paid does not)
    const userPlanData = await getUserPlan(req.userId!);
    const features = getFeatureAccess(userPlanData.plan, userPlanData.isOnTrial);
    if (!features.auditReports) {
      res.status(403).json({ error: "Audit reports are available on Growth and Agency plans. Upgrade to access this feature." });
      return;
    }

    // Fetch lead (must belong to user)
    const { data: lead, error } = await supabase
      .from("leads")
      .select("id, website, enriched_data")
      .eq("id", leadId)
      .eq("user_id", req.userId)
      .single();

    if (error || !lead) {
      res.status(404).json({ error: "Lead not found" });
      return;
    }

    // If lead already has an audit token, return it
    if (lead.enriched_data?.audit_token) {
      const baseUrl = process.env.FRONTEND_URL || "http://localhost:3000";
      res.json({
        token: lead.enriched_data.audit_token,
        url: `${baseUrl}/audit/${lead.enriched_data.audit_token}`,
      });
      return;
    }

    // Check lead has enriched data (any non-empty object means it was processed)
    if (!lead.enriched_data || Object.keys(lead.enriched_data).length === 0) {
      res.status(400).json({ error: "Lead must be enriched before generating an audit report. Click 'Enrich Leads' first." });
      return;
    }

    // Get user's service type to store with the audit
    const userPlan = await getUserPlan(req.userId!);
    const serviceType = userPlan.serviceType;

    // Generate a short, URL-safe token
    const token = crypto.randomBytes(12).toString("base64url"); // 16-char token

    // PageSpeed is fetched in the BACKGROUND, never awaited here. Two Lighthouse runs take
    // 25–90s each, and holding this request open for that long makes the button look broken
    // while the work quietly succeeds. The prospect opens the report later; the data lands
    // long before then, and the report view has its own backstop fetch.
    // Fall back to the crawled URL — see the note in routes/generate.ts. Keying off the
    // `website` column alone skipped Lighthouse entirely for any lead whose discovered URL
    // failed to persist.
    const psUrl: string = lead.website || lead.enriched_data?.analyzedUrl || "";
    const needsPageSpeed = !lead.enriched_data.pageSpeed && !!psUrl && !lead.enriched_data._siteDown && !lead.enriched_data.isParkedDomain;

    // Token FIRST, then Lighthouse. The order matters: this write patches only the two audit
    // keys via a fresh read, so it cannot erase a `pageSpeed` that another path stored while
    // this request was running — which is precisely what a `{ ...lead.enriched_data }` spread
    // did here, wiping the gauges off reports that had already been measured.
    const stored = await mergeEnrichedData(leadId, {
      audit_token: token,
      audit_service_type: serviceType,
    });

    if (!stored) {
      logger.error({ leadId }, "Failed to store audit token");
      res.status(500).json({ error: "Failed to generate audit report" });
      return;
    }

    if (needsPageSpeed) schedulePageSpeedInBackground(lead.id, psUrl);

    const baseUrl = process.env.FRONTEND_URL || "http://localhost:3000";

    res.json({
      token,
      url: `${baseUrl}/audit/${token}`,
    });
  } catch (err) {
    logger.error({ err }, "Audit generate error");
    res.status(500).json({ error: "Failed to generate audit report" });
  }
});

// GET /api/audit/hot-leads — Get all leads who viewed their audit report, with view stats
// Requires auth — only the lead owner sees their views
// IMPORTANT: Must be defined BEFORE /:token to avoid route collision
router.get("/hot-leads", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    // Get all audit views for this user
    const { data: views, error: viewsError } = await supabase
      .from("audit_views")
      .select("lead_id, device, viewed_at")
      .eq("user_id", req.userId)
      .order("viewed_at", { ascending: false });

    if (viewsError || !views || views.length === 0) {
      res.json({ hotLeads: [] });
      return;
    }

    // Aggregate views per lead
    const viewStats: Record<string, { totalViews: number; firstViewed: string; lastViewed: string; devices: Set<string> }> = {};
    for (const v of views) {
      if (!viewStats[v.lead_id]) {
        viewStats[v.lead_id] = { totalViews: 0, firstViewed: v.viewed_at, lastViewed: v.viewed_at, devices: new Set() };
      }
      viewStats[v.lead_id].totalViews++;
      viewStats[v.lead_id].devices.add(v.device || "desktop");
      if (v.viewed_at < viewStats[v.lead_id].firstViewed) {
        viewStats[v.lead_id].firstViewed = v.viewed_at;
      }
      if (v.viewed_at > viewStats[v.lead_id].lastViewed) {
        viewStats[v.lead_id].lastViewed = v.viewed_at;
      }
    }

    const leadIds = Object.keys(viewStats);

    // Fetch lead details
    const { data: leads, error: leadsError } = await supabase
      .from("leads")
      .select("id, name, email, company, website, phone, industry, score, campaign_id, contact_method, contacted")
      .in("id", leadIds);

    if (leadsError || !leads) {
      res.json({ hotLeads: [] });
      return;
    }

    // Fetch campaign names
    const campaignIds = [...new Set(leads.map(l => l.campaign_id).filter(Boolean))];
    let campaignNames: Record<string, string> = {};
    if (campaignIds.length > 0) {
      const { data: campaigns } = await supabase
        .from("campaigns")
        .select("id, name")
        .in("id", campaignIds);
      if (campaigns) {
        for (const c of campaigns) {
          campaignNames[c.id] = c.name;
        }
      }
    }

    // Check which leads have replied
    const { data: repliedEmails } = await supabase
      .from("emails")
      .select("lead_id")
      .eq("user_id", req.userId)
      .eq("replied", true)
      .in("lead_id", leadIds);

    const repliedLeadIds = new Set((repliedEmails || []).map((e: any) => e.lead_id));

    // Build hot leads response
    const hotLeads = leads.map(lead => {
      const stats = viewStats[lead.id];
      return {
        id: lead.id,
        name: lead.name,
        email: lead.email,
        company: lead.company,
        website: lead.website,
        phone: lead.phone,
        industry: lead.industry,
        score: lead.score,
        contactMethod: lead.contact_method,
        contacted: lead.contacted,
        campaignId: lead.campaign_id,
        campaignName: campaignNames[lead.campaign_id] || "Unknown",
        replied: repliedLeadIds.has(lead.id),
        totalViews: stats.totalViews,
        firstViewed: stats.firstViewed,
        lastViewed: stats.lastViewed,
        devices: [...stats.devices],
      };
    });

    // Sort by total views (most engaged first), then by recency
    hotLeads.sort((a, b) => {
      if (b.totalViews !== a.totalViews) return b.totalViews - a.totalViews;
      return new Date(b.lastViewed).getTime() - new Date(a.lastViewed).getTime();
    });

    res.json({ hotLeads });
  } catch (err) {
    logger.error({ err }, "Hot leads error");
    res.status(500).json({ error: "Failed to fetch hot leads" });
  }
});

// GET /api/audit/views/recent — Get recent audit views for the current user (dashboard activity feed)
// Requires auth — only the lead owner sees their views
// IMPORTANT: Must be defined BEFORE /:token to avoid route collision
router.get("/views/recent", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { data: views, error } = await supabase
      .from("audit_views")
      .select("id, lead_id, device, viewed_at")
      .eq("user_id", req.userId)
      .order("viewed_at", { ascending: false })
      .limit(20);

    if (error) {
      res.status(500).json({ error: "Failed to fetch views" });
      return;
    }

    if (!views || views.length === 0) {
      res.json({ views: [], leads: {} });
      return;
    }

    // Fetch lead info for these views
    const leadIds = [...new Set(views.map(v => v.lead_id))];
    const { data: leads } = await supabase
      .from("leads")
      .select("id, company, campaign_id")
      .in("id", leadIds);

    const leadsMap: Record<string, { company: string; campaign_id: string }> = {};
    if (leads) {
      for (const l of leads) {
        leadsMap[l.id] = { company: l.company, campaign_id: l.campaign_id };
      }
    }

    res.json({ views, leads: leadsMap });
  } catch (err) {
    logger.error({ err }, "Audit views recent error");
    res.status(500).json({ error: "Failed to fetch recent views" });
  }
});

// GET /api/audit/views/campaign/:id — Get audit view counts per lead for a campaign
// Requires auth — must be defined BEFORE /:token
router.get("/views/campaign/:id", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { id: campaignId } = req.params;

    // Get all leads in this campaign that have audit tokens
    const { data: leads, error: leadsError } = await supabase
      .from("leads")
      .select("id")
      .eq("campaign_id", campaignId)
      .eq("user_id", req.userId)
      .not("enriched_data->>audit_token", "is", null);

    if (leadsError || !leads || leads.length === 0) {
      res.json({ viewData: {} });
      return;
    }

    const leadIds = leads.map(l => l.id);

    // Get all views for these leads
    const { data: views, error: viewsError } = await supabase
      .from("audit_views")
      .select("lead_id, device, viewed_at")
      .in("lead_id", leadIds)
      .order("viewed_at", { ascending: false });

    if (viewsError || !views) {
      res.json({ viewData: {} });
      return;
    }

    // Aggregate per lead: { leadId: { count, lastViewed, device } }
    const viewData: Record<string, { count: number; lastViewed: string; device: string }> = {};
    for (const v of views) {
      if (!viewData[v.lead_id]) {
        viewData[v.lead_id] = { count: 0, lastViewed: v.viewed_at, device: v.device };
      }
      viewData[v.lead_id].count++;
    }

    res.json({ viewData });
  } catch (err) {
    logger.error({ err }, "Audit views campaign error");
    res.status(500).json({ error: "Failed to fetch campaign views" });
  }
});

// GET /api/audit/:token — Public endpoint: fetch audit data by token
// NO AUTH required — this is what the prospect sees
router.get("/:token", async (req, res) => {
  try {
    // Strip trailing punctuation that email clients may attach to URLs
    const token = req.params.token.replace(/[.,;:!?)]+$/, "");

    if (!token || token.length < 10 || token.length > 30) {
      res.status(400).json({ error: "Invalid audit token" });
      return;
    }

    // Find lead by audit token in enriched_data JSONB
    const { data: leads, error } = await supabase
      .from("leads")
      .select("id, company, website, industry, score, enriched_data, detected_language, source_id")
      .eq("enriched_data->>audit_token", token)
      .limit(1);

    if (error || !leads || leads.length === 0) {
      res.status(404).json({ error: "Audit report not found" });
      return;
    }

    const lead = leads[0];
    let ed = lead.enriched_data || {};
    const serviceType = ed.audit_service_type || "web_dev";

    // Fetch PageSpeed in the background if it isn't stored yet.
    //
    // The cooldown exists because this is a PUBLIC endpoint: a site that reliably fails would
    // otherwise re-fire the Google API on every view. But it was 24 HOURS and was stamped
    // BEFORE the attempt, so one timeout locked a lead out of Lighthouse data for a full day —
    // which is why four web-dev reports in a row showed no gauges. 30 minutes is enough to
    // stop abuse (at most two runs an hour per lead), and the stamp is now written by the
    // scheduler only when the fetch actually FAILS, so a success is never penalised.
    const PAGESPEED_RETRY_MS = 30 * 60 * 1000;
    const pageSpeedLastTried = ed.pageSpeedTriedAt ? new Date(ed.pageSpeedTriedAt).getTime() : 0;
    const viewPsUrl: string = lead.website || ed.analyzedUrl || "";
    const pageSpeedEligible = !ed.pageSpeed && !!viewPsUrl && !ed._siteDown && !ed.isParkedDomain;
    // `isPageSpeedInFlight` is checked BEFORE logging, not just inside the scheduler. The
    // report page polls this endpoint every few seconds while it waits, and each poll was
    // emitting a "Fetching PageSpeed" line for a run that was already going — a dozen log
    // entries implying a dozen Google calls that never happened.
    if (pageSpeedEligible && !isPageSpeedInFlight(lead.id)
        && (Date.now() - pageSpeedLastTried > PAGESPEED_RETRY_MS)) {
      logger.info({ website: viewPsUrl, leadId: lead.id }, "Fetching PageSpeed in background for audit view");
      // The scheduler de-duplicates in-process, re-reads the row before writing so a late
      // Lighthouse run can't clobber enrichment, and records the failure stamp itself.
      schedulePageSpeedInBackground(lead.id, viewPsUrl);
    }

    // Tell the browser whether Lighthouse data is still on its way.
    //
    // Two Lighthouse runs take 30–90s and are no longer awaited inside any request, so the
    // FIRST view of a fresh report reliably rendered before the numbers existed — no gauges,
    // no Core Web Vitals, and mobile performance silently dropped out of the composite score.
    // The report looked like the feature had been removed. With this flag the page polls until
    // the data lands and fills itself in, instead of depending on the reader guessing to hit
    // refresh.
    const pageSpeedPending = pageSpeedEligible && isPageSpeedInFlight(lead.id);

    // --- Real comparison benchmark ------------------------------------------
    // Average "health" of businesses we've analysed, for an honest comparison.
    // `score` is the opportunity score (higher = more website problems); the
    // report displays healthScore = 100 - score, so we convert the average the
    // same way.
    //
    // Industry labels are fragmented, so we group them into broad parent buckets
    // (see industryGroups.ts) and average within the prospect's bucket. Resolution
    // order: (1) the prospect's industry GROUP if it has enough samples; (2) the
    // exact industry label, so unmapped niches still pool; (3) all industries.
    // Below the threshold at every level we return null and the report hides the
    // comparison. Best-effort — a failure here must never break the report.
    const MIN_BENCHMARK_SAMPLES = 15;
    const BENCHMARK_SAMPLE_CAP = 5000;
    let benchmark: { avgHealth: number; sampleCount: number; scope: "industry" | "all"; label: string } | null = null;
    try {
      const { canonicalIndustry } = await import("../services/industryGroups");

      // Use a cached sample set so this doesn't scan up to 5000 rows on every public view.
      const nowMs = Date.now();
      let allRows = benchmarkRowsCache && benchmarkRowsCache.expiresAt > nowMs ? benchmarkRowsCache.rows : null;
      if (!allRows) {
        const { data } = await supabase
          .from("leads")
          .select("id, industry, score")
          .gt("score", 0)
          .limit(BENCHMARK_SAMPLE_CAP);
        allRows = data || [];
        benchmarkRowsCache = { rows: allRows, expiresAt: nowMs + BENCHMARK_CACHE_TTL };
      }
      // Exclude the current lead from its own benchmark (done in-memory since rows are cached).
      const rows = allRows.filter((r) => r.id !== lead.id);

      if (rows && rows.length > 0) {
        const avgHealthFromScores = (scores: number[]): number => {
          const avgScore = scores.reduce((sum, n) => sum + n, 0) / scores.length;
          return Math.round(Math.max(0, Math.min(100, 100 - avgScore)));
        };

        // 1) Prospect's industry group (e.g. all "lawyer" variants → Legal)
        const prospectGroup = canonicalIndustry(lead.industry);
        if (prospectGroup) {
          const groupScores = rows
            .filter((r) => canonicalIndustry(r.industry as string | null)?.key === prospectGroup.key)
            .map((r) => (r.score as number) || 0);
          if (groupScores.length >= MIN_BENCHMARK_SAMPLES) {
            benchmark = { avgHealth: avgHealthFromScores(groupScores), sampleCount: groupScores.length, scope: "industry", label: prospectGroup.label };
          }
        }

        // 2) Exact industry label (covers niches not mapped to any group)
        if (!benchmark) {
          const raw = (lead.industry || "").trim().toLowerCase();
          if (raw) {
            const exactScores = rows
              .filter((r) => ((r.industry as string | null) || "").trim().toLowerCase() === raw)
              .map((r) => (r.score as number) || 0);
            if (exactScores.length >= MIN_BENCHMARK_SAMPLES) {
              benchmark = { avgHealth: avgHealthFromScores(exactScores), sampleCount: exactScores.length, scope: "industry", label: lead.industry || "your industry" };
            }
          }
        }

        // 3) All industries
        if (!benchmark && rows.length >= MIN_BENCHMARK_SAMPLES) {
          benchmark = { avgHealth: avgHealthFromScores(rows.map((r) => (r.score as number) || 0)), sampleCount: rows.length, scope: "all", label: "business" };
        }
      }
    } catch (err) {
      logger.warn({ err }, "Benchmark computation failed (non-fatal)");
    }

    // Real local-competitor comparison (same trade, same city, Google's own review data).
    // Best-effort: a failure here must never break the report.
    const myReviewCount = Number.isFinite(Number(ed.googleReviewCount))
      ? Number(ed.googleReviewCount)
      : null;
    const localMarket = await getLocalMarket(lead.source_id ?? null, lead.id, myReviewCount);

    // Return only safe, public-facing data — strip internal fields
    res.json({
      company: lead.company,
      // Prefer the column, but fall back to the URL we actually crawled so a report built
      // from six analysed pages never renders without an address.
      website: lead.website || ed.analyzedUrl || null,
      pageSpeedPending,
      localMarket,
      industry: lead.industry || ed.industry || "Local Business",
      score: lead.score,
      benchmark,
      serviceType,
      language: lead.detected_language || "eng",
      summary: ed.summary || null,
      issues: ed.issues || [],
      opportunity: ed.opportunity || null,
      signals: {
        hasOnlineBooking: ed.hasOnlineBooking ?? null,
        hasContactForm: ed.hasContactForm ?? null,
        hasSSL: ed.hasSSL ?? null,
        isMobileFriendly: ed.isMobileFriendly ?? null,
        hasMetaDescription: ed.hasMetaDescription ?? null,
        pageLoadTimeMs: ed.pageLoadTimeMs ?? null,
        pageSizeKB: ed.pageSizeKB ?? null,
        copyrightYear: ed.copyrightYear ?? null,
        socialLinks: ed.socialLinks?.length ?? 0,
        technologies: ed.technologies || [],
        isParkedDomain: ed.isParkedDomain ?? false,
        _siteDown: ed._siteDown ?? false,
        // Needed by the report so it can withhold content-dependent findings on JS-rendered
        // sites instead of reporting our blind spot as the business's missing feature.
        // scoreLead already skips those penalties; the report was never told.
        isSPA: ed.isSPA ?? null,
        pageSpeed: ed.pageSpeed ?? null,
        hasGoogleAds: ed.hasGoogleAds ?? null,
        hasFacebookPixel: ed.hasFacebookPixel ?? null,
        hasAnalytics: ed.hasAnalytics ?? null,
        googleRating: ed.googleRating ?? null,
        googleReviewCount: ed.googleReviewCount ?? null,
        // Digital marketing signals
        hasLeadCaptureForm: ed.hasLeadCaptureForm ?? null,
        hasOpenGraph: ed.hasOpenGraph ?? null,
        hasSchemaMarkup: ed.hasSchemaMarkup ?? null,
        hasEmailMarketing: ed.hasEmailMarketing ?? null,
        hasCTA: ed.hasCTA ?? null,
        hasRetargeting: ed.hasRetargeting ?? null,

        // ===== Deep SEO signals =====
        // Every one of these defaults to null, NOT false. A lead enriched before these
        // checks existed has no data for them, and the report must omit those findings
        // rather than report a missing signal as a failure.
        hasRobotsTxt: ed.hasRobotsTxt ?? null,
        robotsBlocksSite: ed.robotsBlocksSite ?? null,
        robotsSitemapDeclared: ed.robotsSitemapDeclared ?? null,
        robotsBlockedPaths: ed.robotsBlockedPaths ?? [],
        hasSitemap: ed.hasSitemap ?? null,
        sitemapUrlCount: ed.sitemapUrlCount ?? null,
        isSitemapIndex: ed.isSitemapIndex ?? null,
        redirectsToHttps: ed.redirectsToHttps ?? null,
        internalLinkCount: ed.internalLinkCount ?? null,
        checkedLinkCount: ed.checkedLinkCount ?? null,
        brokenInternalLinks: ed.brokenInternalLinks ?? [],
        redirectingInternalLinks: ed.redirectingInternalLinks ?? [],
        titleLength: ed.titleLength ?? null,
        hasTitle: ed.hasTitle ?? null,
        h1Count: ed.h1Count ?? null,
        headingCounts: ed.headingCounts ?? null,
        emptyHeadingCount: ed.emptyHeadingCount ?? null,
        hasHeadingHierarchyIssues: ed.hasHeadingHierarchyIssues ?? null,
        headingIssues: ed.headingIssues ?? [],
        hasCanonical: ed.hasCanonical ?? null,
        canonicalIssue: ed.canonicalIssue ?? null,
        isIndexable: ed.isIndexable ?? null,
        hasNoindex: ed.hasNoindex ?? null,
        hasNofollow: ed.hasNofollow ?? null,
        noindexSource: ed.noindexSource ?? null,
        imageCount: ed.imageCount ?? null,
        imagesWithAlt: ed.imagesWithAlt ?? null,
        imagesWithoutAlt: ed.imagesWithoutAlt ?? null,
        emptyAltCount: ed.emptyAltCount ?? null,
        altTextCoverage: ed.altTextCoverage ?? null,
        wordCount: ed.wordCount ?? null,
        isThinContent: ed.isThinContent ?? null,
        pagesAnalyzed: ed.pagesAnalyzed ?? null,
        duplicateTitleCount: ed.duplicateTitleCount ?? null,
        duplicateMetaDescriptionCount: ed.duplicateMetaDescriptionCount ?? null,
        duplicateH1Count: ed.duplicateH1Count ?? null,
        duplicateTitles: ed.duplicateTitles ?? [],
        duplicateH1s: ed.duplicateH1s ?? [],
        schemaTypes: ed.schemaTypes ?? [],
        hasLocalBusinessSchema: ed.hasLocalBusinessSchema ?? null,
        hasHreflang: ed.hasHreflang ?? null,
        hreflangLanguages: ed.hreflangLanguages ?? [],
        hreflangIssues: ed.hreflangIssues ?? [],
        hasBusinessAddress: ed.hasBusinessAddress ?? null,
        hasVisiblePhone: ed.hasVisiblePhone ?? null,
        napConsistency: ed.napConsistency ?? null,

        // ===== Deep marketing signals =====
        marketingTechnologies: ed.marketingTechnologies ?? null,
        techByCategory: ed.techByCategory ?? null,
        hasClarity: ed.hasClarity ?? null,
        hasHotjar: ed.hasHotjar ?? null,
        hasMicrosoftUET: ed.hasMicrosoftUET ?? null,
        hasHubSpot: ed.hasHubSpot ?? null,
        hasTagManager: ed.hasTagManager ?? null,
        hasLiveChat: ed.hasLiveChat ?? null,
        hasHeatmapTool: ed.hasHeatmapTool ?? null,
        formFieldCount: ed.formFieldCount ?? null,
        requiredFieldCount: ed.requiredFieldCount ?? null,
        formFriction: ed.formFriction ?? null,
        formHasPhoneRequired: ed.formHasPhoneRequired ?? null,
        ctaTexts: ed.ctaTexts ?? [],
        primaryCTA: ed.primaryCTA ?? null,
        ctaStrength: ed.ctaStrength ?? null,
        ctaAboveFold: ed.ctaAboveFold ?? null,
        ctaCount: ed.ctaCount ?? null,
        competingCtas: ed.competingCtas ?? null,
        competingCtaTexts: ed.competingCtaTexts ?? [],
        hasLeadMagnet: ed.hasLeadMagnet ?? null,
        leadMagnetType: ed.leadMagnetType ?? null,
        hasConversionPopup: ed.hasConversionPopup ?? null,
        popupTechnology: ed.popupTechnology ?? null,
        hasClearConversionPath: ed.hasClearConversionPath ?? null,
        conversionPathIssues: ed.conversionPathIssues ?? [],
        conversionDestinationType: ed.conversionDestinationType ?? null,
        socialPlatformCount: ed.socialPlatformCount ?? null,
        socialPlatforms: ed.socialPlatforms ?? [],
        socialPresenceStrength: ed.socialPresenceStrength ?? null,
      },
    });
  } catch (err) {
    logger.error({ err }, "Audit fetch error");
    res.status(500).json({ error: "Failed to load audit report" });
  }
});

// POST /api/audit/:token/view — Track when a lead views their audit report
// NO AUTH required — this is called from the public audit page
router.post("/:token/view", async (req, res) => {
  try {
    const token = req.params.token.replace(/[.,;:!?)]+$/, "");

    if (!token || token.length < 10 || token.length > 30) {
      res.status(400).json({ error: "Invalid token" });
      return;
    }

    // Find the lead by audit token
    const { data: leads, error } = await supabase
      .from("leads")
      .select("id, user_id")
      .eq("enriched_data->>audit_token", token)
      .limit(1);

    if (error || !leads || leads.length === 0) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const lead = leads[0];

    // Hash IP for deduplication (don't store raw IP for privacy)
    const rawIp = req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() || req.ip || "unknown";
    const ipHash = crypto.createHash("sha256").update(rawIp + token).digest("hex").substring(0, 16);

    // Deduplicate: skip if same IP viewed within 30 minutes
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data: recentView } = await supabase
      .from("audit_views")
      .select("id")
      .eq("lead_id", lead.id)
      .eq("ip_hash", ipHash)
      .gte("viewed_at", thirtyMinAgo)
      .limit(1);

    if (recentView && recentView.length > 0) {
      // Already counted this view recently
      res.json({ ok: true, deduplicated: true });
      return;
    }

    // Detect device from user-agent
    const ua = (req.headers["user-agent"] || "").toLowerCase();
    const device = /mobile|android|iphone|ipad/.test(ua) ? "mobile" : "desktop";

    // Insert the view record
    await supabase.from("audit_views").insert({
      lead_id: lead.id,
      user_id: lead.user_id,
      ip_hash: ipHash,
      device,
    });

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Audit view tracking error");
    res.status(500).json({ error: "Failed to track view" });
  }
});

export default router;
