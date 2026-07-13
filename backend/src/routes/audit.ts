import { Router } from "express";
import crypto from "crypto";
import { authMiddleware, AuthenticatedRequest } from "../middleware/auth";
import supabase from "../services/supabase";
import { getPageSpeedScores } from "../services/pageSpeed";
import { getUserPlan, getFeatureAccess } from "../services/planLimits";
import logger from "../utils/logger";

const router = Router();

// POST /api/audit/generate — Generate an audit report token for a lead
// Requires auth — only the lead owner can generate audit links
router.post("/generate", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { leadId } = req.body;

    if (!leadId) {
      res.status(400).json({ error: "Lead ID is required" });
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

    // Fetch PageSpeed only for web_dev and seo (not needed for digital_marketing)
    let enrichedUpdate = { ...lead.enriched_data, audit_token: token, audit_service_type: serviceType };
    const needsPageSpeed = (serviceType === "web_dev" || serviceType === "seo") && !lead.enriched_data.pageSpeed && lead.website && !lead.enriched_data._siteDown && !lead.enriched_data.isParkedDomain;
    if (needsPageSpeed) {
      const pageSpeedData = await getPageSpeedScores(lead.website);
      if (pageSpeedData) {
        enrichedUpdate.pageSpeed = pageSpeedData;
      }
    }

    const { error: updateError } = await supabase
      .from("leads")
      .update({
        enriched_data: enrichedUpdate,
      })
      .eq("id", leadId)
      .eq("user_id", req.userId);

    if (updateError) {
      logger.error({ updateError }, "Failed to store audit token");
      res.status(500).json({ error: "Failed to generate audit report" });
      return;
    }

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
      .select("id, company, website, industry, score, enriched_data, detected_language")
      .eq("enriched_data->>audit_token", token)
      .limit(1);

    if (error || !leads || leads.length === 0) {
      res.status(404).json({ error: "Audit report not found" });
      return;
    }

    const lead = leads[0];
    let ed = lead.enriched_data || {};
    const serviceType = ed.audit_service_type || "web_dev";

    // Fetch PageSpeed in background if not yet stored (only for web_dev and seo)
    // Don't block the response — prospect sees the report immediately, PageSpeed loads on next visit
    if ((serviceType === "web_dev" || serviceType === "seo") && !ed.pageSpeed && lead.website && !ed._siteDown && !ed.isParkedDomain) {
      logger.info({ website: lead.website, leadId: lead.id }, "Fetching PageSpeed in background for audit view");
      getPageSpeedScores(lead.website).then(pageSpeedData => {
        if (pageSpeedData) {
          supabase.from("leads")
            .update({ enriched_data: { ...ed, pageSpeed: pageSpeedData } })
            .eq("id", lead.id)
            .then(() => {});
        }
      }).catch(() => {});
    }

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

      const { data: rows } = await supabase
        .from("leads")
        .select("industry, score")
        .gt("score", 0)
        .neq("id", lead.id)
        .limit(BENCHMARK_SAMPLE_CAP);

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

    // Return only safe, public-facing data — strip internal fields
    res.json({
      company: lead.company,
      website: lead.website,
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
