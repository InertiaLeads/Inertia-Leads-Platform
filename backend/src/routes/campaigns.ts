import { Router } from "express";
import { authMiddleware, AuthenticatedRequest } from "../middleware/auth";
import supabase from "../services/supabase";
import { isValidUUID } from "../middleware/validate";
import { auditLog } from "../utils/auditLog";
import logger from "../utils/logger";

const router = Router();

// GET /api/campaigns — List all campaigns for user
router.get("/", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { data: campaigns, error } = await supabase
      .from("campaigns")
      .select("*")
      .eq("user_id", req.userId)
      .order("created_at", { ascending: false });

    if (error) {
      res.status(500).json({ error: "Failed to fetch campaigns" });
      return;
    }

    // Compute real lead counts via database aggregation (single query, no row limits)
    if (campaigns && campaigns.length > 0) {
      const campaignIds = campaigns.map((c: any) => c.id);
      const { data: counts } = await supabase.rpc("get_campaign_lead_counts", {
        p_user_id: req.userId,
        p_campaign_ids: campaignIds,
      });

      if (counts) {
        const countMap: Record<string, { total: number; queued: number; has_auto_find: boolean; has_csv: boolean }> = {};
        for (const row of counts) {
          countMap[row.campaign_id] = row;
        }
        for (const c of campaigns) {
          const cnt = countMap[c.id] || { total: 0, queued: 0, has_auto_find: false, has_csv: false };
          c.total_leads = cnt.total;
          c.queued_leads = cnt.queued;
          // Derive campaign source
          if (!cnt.has_auto_find && !cnt.has_csv) c.source = "csv";
          else if (cnt.has_auto_find && cnt.has_csv) c.source = "mixed";
          else if (cnt.has_auto_find) c.source = "auto_find";
          else c.source = "csv";
        }
      }
    }

    res.json({ campaigns });
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/campaigns/lead-search?q= — Find a LEAD across every campaign
//
// Exists because of a workflow dead end: when a prospect replies, the user must mark that
// lead as replied to stop the remaining follow-ups — but the Mark-replied control lives inside
// one campaign's email modal. With dozens of campaigns there was no way to discover WHICH
// campaign held the lead, so the only route to it was opening campaigns one by one.
//
// This returns the lead itself plus the campaign it belongs to and the id of the email to
// mark, so the caller can act without navigating at all. Read-only; the actual marking still
// goes through the existing POST /api/send/mark-reply.
//
// MUST stay above `/:id` — Express matches in order, and "lead-search" would otherwise be
// swallowed as a campaign id.
router.get("/lead-search", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const q = String(req.query.q || "").trim();

    // Two characters minimum. A single letter matches most of the table and the result is
    // noise, not a search.
    if (q.length < 2) {
      res.json({ leads: [] });
      return;
    }

    const LIMIT = 20;
    // `.or()` builds a raw PostgREST filter string in which commas separate conditions and
    // parentheses group them. Plenty of real company names contain both — "Dias Law Firm,
    // Inc." — so interpolating the query bare would split one condition into several and
    // corrupt the filter. Stripping those characters is not an option either, since it would
    // stop that exact name from ever matching.
    //
    // PostgREST treats a double-quoted value as a literal, and JSON.stringify produces
    // exactly that: a quoted, correctly backslash-escaped string. Using it avoids
    // hand-rolling escape sequences, which is easy to get subtly wrong.
    //
    // `%` and `_` are deliberately left alone: they act as LIKE wildcards, which still match
    // the literal character the user typed, so nothing breaks either way.
    const quoted = JSON.stringify(`%${q}%`);

    const { data: leads, error } = await supabase
      .from("leads")
      .select("id, company, email, phone, website, campaign_id, contact_method")
      .eq("user_id", req.userId)
      .or(`email.ilike.${quoted},company.ilike.${quoted},phone.ilike.${quoted}`)
      .order("created_at", { ascending: false })
      .limit(LIMIT);

    if (error) {
      logger.warn({ error: error.message }, "Lead search failed");
      res.status(500).json({ error: "Search failed" });
      return;
    }

    if (!leads || leads.length === 0) {
      res.json({ leads: [] });
      return;
    }

    // Campaign names in one query rather than one per lead.
    const campaignIds = [...new Set(leads.map((l: any) => l.campaign_id).filter(Boolean))];
    const campaignNames = new Map<string, string>();
    if (campaignIds.length > 0) {
      const { data: camps } = await supabase
        .from("campaigns")
        .select("id, name")
        .eq("user_id", req.userId)
        .in("id", campaignIds);
      for (const c of camps || []) campaignNames.set(c.id, c.name);
    }

    // Every email for these leads, so each row can say whether marking it would actually
    // stop anything. A lead whose sequence already finished has nothing to cancel, and saying
    // so is more useful than offering a button that does nothing.
    const leadIds = leads.map((l: any) => l.id);
    // The error IS checked below. Without that, a wrong column name fails silently: `data`
    // comes back null, every row reports sent=0/pending=0, and the Mark-replied button never
    // renders — a broken feature that merely looks like "this lead has no emails yet". That
    // exact bug happened here, on the scheduled-date column name.
    const { data: emails, error: emailsError } = await supabase
      .from("emails")
      .select("id, lead_id, status, replied, sequence_step, scheduled_at, sent_at")
      .eq("user_id", req.userId)
      .in("lead_id", leadIds);

    if (emailsError) {
      logger.warn({ error: emailsError.message }, "Lead search: email lookup failed");
      res.status(500).json({ error: "Search failed" });
      return;
    }

    const byLead = new Map<string, any[]>();
    for (const e of emails || []) {
      const list = byLead.get(e.lead_id) || [];
      list.push(e);
      byLead.set(e.lead_id, list);
    }

    const rows = leads.map((lead: any) => {
      const mine = byLead.get(lead.id) || [];
      const sent = mine.filter((e) => e.status === "sent");
      const pending = mine.filter((e) => e.status === "pending");

      // The email to mark is the LATEST one actually sent — that is what the prospect replied
      // to. Marking it cancels every pending follow-up for the lead, which the existing
      // mark-reply endpoint already handles by lead_id.
      const latestSent = sent
        .slice()
        .sort((a, b) => new Date(b.sent_at || 0).getTime() - new Date(a.sent_at || 0).getTime())[0];

      const nextPending = pending
        .slice()
        .sort((a, b) => new Date(a.scheduled_at || 0).getTime() - new Date(b.scheduled_at || 0).getTime())[0];

      return {
        leadId: lead.id,
        company: lead.company,
        email: lead.email,
        phone: lead.phone,
        contactMethod: lead.contact_method,
        campaignId: lead.campaign_id,
        campaignName: lead.campaign_id ? campaignNames.get(lead.campaign_id) || null : null,
        // null when nothing has been sent yet — the UI uses this to decide whether a
        // Mark-replied button makes any sense for this row.
        markableEmailId: latestSent?.id || null,
        alreadyReplied: mine.some((e) => e.replied),
        sentCount: sent.length,
        pendingCount: pending.length,
        lastStep: latestSent?.sequence_step ?? null,
        nextFollowUpAt: nextPending?.scheduled_at || null,
      };
    });

    res.json({ leads: rows });
  } catch (err) {
    logger.error({ err }, "Lead search error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/campaigns/:id — Get a single campaign with its leads
router.get("/:id", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    if (!isValidUUID(id)) {
      res.status(400).json({ error: "Invalid campaign ID format" });
      return;
    }

    const { data: campaign, error: campaignError } = await supabase
      .from("campaigns")
      .select("*")
      .eq("id", id)
      .eq("user_id", req.userId)
      .single();

    if (campaignError || !campaign) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }

    const { data: leads } = await supabase
      .from("leads")
      .select("*")
      .eq("campaign_id", id)
      .eq("user_id", req.userId);

    const { data: emails } = await supabase
      .from("emails")
      .select("*, gmail_accounts(email)")
      .eq("campaign_id", id)
      .eq("user_id", req.userId)
      .order("sequence_step", { ascending: true });

    // Auto-cancel pending follow-ups for leads that already have a reply
    const repliedLeadIds = new Set(
      (emails || []).filter((e: any) => e.replied === true).map((e: any) => e.lead_id)
    );
    const staleFollowups = (emails || []).filter(
      (e: any) => e.status === "pending" && e.sequence_step > 1 && repliedLeadIds.has(e.lead_id)
    );
    if (staleFollowups.length > 0) {
      await supabase
        .from("emails")
        .update({ status: "cancelled" })
        .in("id", staleFollowups.map((e: any) => e.id));
      // Update local array
      for (const e of staleFollowups) {
        e.status = "cancelled";
      }
    }

    // Flatten gmail_accounts join into gmail_email field
    const enrichedEmails = (emails || []).map(e => ({
      ...e,
      gmail_email: e.gmail_accounts?.email || null,
      gmail_accounts: undefined,
    }));

    // Use actual leads count instead of potentially stale total_leads column
    campaign.total_leads = (leads || []).length;

    res.json({ campaign, leads: leads || [], emails: enrichedEmails });
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /api/campaigns/:id — Update campaign settings
router.put("/:id", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    if (!isValidUUID(id)) {
      res.status(400).json({ error: "Invalid campaign ID format" });
      return;
    }
    const { enable_followups, name, status, send_timezone } = req.body;

    // Verify campaign ownership
    const { data: campaign, error: campaignError } = await supabase
      .from("campaigns")
      .select("id")
      .eq("id", id)
      .eq("user_id", req.userId)
      .single();

    if (campaignError || !campaign) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }

    // Update campaign
    const updateData: any = {};
    if (enable_followups !== undefined) {
      updateData.enable_followups = enable_followups;
    }
    if (name !== undefined) {
      updateData.name = name;
    }
    if (status !== undefined) {
      updateData.status = status;
    }
    if (send_timezone !== undefined) {
      const validTimezones = ["US_EAST", "US_CENTRAL", "US_MOUNTAIN", "US_WEST", "US_ALASKA", "US_HAWAII", "CA_ATLANTIC", "CA_NEWFOUNDLAND", "UK", "EU_CENTRAL", "EU_EAST", "UAE", "ARABIA", "INDIA", "SINGAPORE", "PHILIPPINES", "JAPAN", "AU_WEST", "AU_CENTRAL", "AU_EAST", "NZ", "BRAZIL", "SOUTH_AFRICA"];
      if (validTimezones.includes(send_timezone)) {
        updateData.send_timezone = send_timezone;
        updateData.settings_confirmed = true;
      }
    }

    const { data: updated, error: updateError } = await supabase
      .from("campaigns")
      .update(updateData)
      .eq("id", id)
      .eq("user_id", req.userId)
      .select()
      .single();

    if (updateError) {
      res.status(500).json({ error: "Failed to update campaign" });
      return;
    }

    res.json({
      message: "Campaign updated successfully",
      campaign: updated,
    });
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/campaigns/:id — Delete a campaign and its associated leads/emails
router.delete("/:id", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    if (!isValidUUID(id)) {
      res.status(400).json({ error: "Invalid campaign ID" });
      return;
    }

    // Verify campaign belongs to user
    const { data: campaign, error: fetchError } = await supabase
      .from("campaigns")
      .select("id")
      .eq("id", id)
      .eq("user_id", req.userId)
      .single();

    if (fetchError || !campaign) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }

    // Delete campaign (leads and emails cascade via FK)
    const { error: deleteError } = await supabase
      .from("campaigns")
      .delete()
      .eq("id", id)
      .eq("user_id", req.userId);

    if (deleteError) {
      res.status(500).json({ error: "Failed to delete campaign" });
      return;
    }

    auditLog({ userId: req.userId, action: "campaign.delete", resource: "campaigns", resourceId: id, req });
    res.json({ message: "Campaign deleted successfully" });
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
