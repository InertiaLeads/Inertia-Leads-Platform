import { Router } from "express";
import { authMiddleware, AuthenticatedRequest } from "../middleware/auth";
import { isValidUUID } from "../middleware/validate";
import { requireFeature } from "../middleware/featureGate";
import supabase from "../services/supabase";
import logger from "../utils/logger";
import { auditLog } from "../utils/auditLog";
import { checkSubscriptionAccess } from "../services/planLimits";
import { sendEmailUnified, getAccountInfo, getPrimaryEmailAccountId } from "../services/emailRouter";
import { REPLY_CLASSIFICATIONS, ReplyClassification, applyClassificationEffects } from "../services/replyClassifier";
import { pauseSequenceForLead } from "../services/smartSequences";

const router = Router();
const gate = requireFeature("unifiedInbox", "The Unified Inbox");

const PAGE_SIZE_MAX = 50;

// Escape a free-text search term for PostgREST's or() filter (commas/parens are syntax).
function safeSearchTerm(q: string): string {
  return q.replace(/[,()%\\"']/g, " ").trim().slice(0, 80);
}

// GET /api/inbox — paginated reply list with filters
//   ?filter=all|unread|archived  ?classification=<cat|unclassified>  ?campaignId=  ?q=  ?page=  ?limit=
router.get("/", authMiddleware, gate, async (req: AuthenticatedRequest, res) => {
  try {
    const filter = String(req.query.filter || "all");
    const classification = String(req.query.classification || "");
    const campaignId = String(req.query.campaignId || "");
    const q = safeSearchTerm(String(req.query.q || ""));
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
    const limit = Math.min(PAGE_SIZE_MAX, Math.max(1, parseInt(String(req.query.limit || "25"), 10) || 25));
    const from = (page - 1) * limit;

    let query = supabase
      .from("replies")
      .select(
        "id, email_id, lead_id, campaign_id, from_email, subject, body_text, received_at, is_read, is_archived, classification, classification_confidence, classified_by, ooo_return_date, " +
        "leads(id, name, company, email, phone, website, score), campaigns(id, name)",
        { count: "exact" }
      )
      .eq("user_id", req.userId)
      .eq("direction", "inbound");

    if (filter === "archived") query = query.eq("is_archived", true);
    else query = query.eq("is_archived", false);
    if (filter === "unread") query = query.eq("is_read", false);

    if (classification === "unclassified") query = query.is("classification", null);
    else if (classification && REPLY_CLASSIFICATIONS.includes(classification as ReplyClassification)) query = query.eq("classification", classification);

    if (campaignId && isValidUUID(campaignId)) query = query.eq("campaign_id", campaignId);
    if (q) query = query.or(`from_email.ilike.%${q}%,subject.ilike.%${q}%,body_text.ilike.%${q}%`);

    const { data, error, count } = await query.order("received_at", { ascending: false }).range(from, from + limit - 1);
    if (error) {
      logger.error({ error: error.message }, "Inbox list failed");
      res.status(500).json({ error: "Failed to load inbox" });
      return;
    }

    const replies = (data || []).map((r: any) => ({
      id: r.id,
      email_id: r.email_id,
      lead_id: r.lead_id,
      campaign_id: r.campaign_id,
      from_email: r.from_email,
      subject: r.subject,
      preview: String(r.body_text || "").replace(/\s+/g, " ").trim().slice(0, 160),
      received_at: r.received_at,
      is_read: r.is_read,
      is_archived: r.is_archived,
      classification: r.classification,
      classification_confidence: r.classification_confidence,
      classified_by: r.classified_by,
      ooo_return_date: r.ooo_return_date,
      lead: r.leads ? { id: r.leads.id, name: r.leads.name, company: r.leads.company, email: r.leads.email, phone: r.leads.phone, website: r.leads.website, score: r.leads.score } : null,
      campaign: r.campaigns ? { id: r.campaigns.id, name: r.campaigns.name } : null,
    }));

    res.json({ replies, total: count || 0, page, limit });
  } catch (err) {
    logger.error({ err }, "Inbox list error");
    res.status(500).json({ error: "Failed to load inbox" });
  }
});

// GET /api/inbox/unread-count — for the sidebar badge (polled every 30s)
router.get("/unread-count", authMiddleware, gate, async (req: AuthenticatedRequest, res) => {
  try {
    const { count } = await supabase
      .from("replies")
      .select("*", { count: "exact", head: true })
      .eq("user_id", req.userId)
      .eq("direction", "inbound")
      .eq("is_read", false)
      .eq("is_archived", false);
    res.json({ unread: count || 0 });
  } catch {
    res.status(500).json({ error: "Failed to load unread count" });
  }
});

// GET /api/inbox/counts — per-classification counts for the filter tabs
router.get("/counts", authMiddleware, gate, async (req: AuthenticatedRequest, res) => {
  try {
    const { data } = await supabase
      .from("replies")
      .select("classification, is_read")
      .eq("user_id", req.userId)
      .eq("direction", "inbound")
      .eq("is_archived", false);
    const counts: Record<string, number> = { all: 0, unread: 0, unclassified: 0 };
    for (const c of REPLY_CLASSIFICATIONS) counts[c] = 0;
    for (const r of data || []) {
      counts.all += 1;
      if (!r.is_read) counts.unread += 1;
      if (r.classification) counts[r.classification] = (counts[r.classification] || 0) + 1;
      else counts.unclassified += 1;
    }
    res.json({ counts });
  } catch {
    res.status(500).json({ error: "Failed to load counts" });
  }
});

// GET /api/inbox/:id/thread — full conversation for the right-hand panel
router.get("/:id/thread", authMiddleware, gate, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    if (!isValidUUID(id)) { res.status(400).json({ error: "Invalid reply ID" }); return; }

    const { data: reply } = await supabase
      .from("replies")
      .select("*")
      .eq("id", id)
      .eq("user_id", req.userId)
      .single();
    if (!reply) { res.status(404).json({ error: "Reply not found" }); return; }

    const [{ data: lead }, { data: campaign }, { data: sentEmails }, { data: messages }] = await Promise.all([
      supabase.from("leads").select("id, name, company, email, phone, website, industry, score, enriched_data, detected_language").eq("id", reply.lead_id).single(),
      supabase.from("campaigns").select("id, name, status").eq("id", reply.campaign_id).single(),
      supabase
        .from("emails")
        .select("id, subject, body, status, sequence_step, sent_at, replied, replied_at, open_count, click_count, is_resend, gmail_account_id, smtp_account_id")
        .eq("lead_id", reply.lead_id)
        .eq("campaign_id", reply.campaign_id)
        .eq("user_id", req.userId)
        .order("sent_at", { ascending: true, nullsFirst: false }),
      supabase
        .from("replies")
        .select("id, direction, from_email, to_email, subject, body_text, body_html, received_at, is_read, classification, classification_confidence, classified_by, ooo_return_date, classification_reason")
        .eq("lead_id", reply.lead_id)
        .eq("campaign_id", reply.campaign_id)
        .eq("user_id", req.userId)
        .order("received_at", { ascending: true }),
    ]);

    // Strip audit_token etc. — the UI only needs a light lead summary
    const leadSummary = lead ? {
      id: lead.id, name: lead.name, company: lead.company, email: lead.email, phone: lead.phone,
      website: lead.website, industry: lead.industry, score: lead.score,
      audit_token: lead.enriched_data?.audit_token || null,
      summary: lead.enriched_data?.summary || null,
    } : null;

    res.json({
      reply: { id: reply.id, email_id: reply.email_id, is_read: reply.is_read, is_archived: reply.is_archived, classification: reply.classification, ooo_return_date: reply.ooo_return_date || null },
      lead: leadSummary,
      campaign,
      sentEmails: (sentEmails || []).filter((e: any) => e.status === "sent"),
      messages: messages || [],
    });
  } catch (err) {
    logger.error({ err }, "Inbox thread error");
    res.status(500).json({ error: "Failed to load conversation" });
  }
});

async function setFlags(userId: string, id: string, patch: Record<string, unknown>) {
  return supabase.from("replies").update(patch).eq("id", id).eq("user_id", userId).select("id").single();
}

// POST /api/inbox/:id/read | /unread | /archive | /unarchive
for (const [path, patch] of [
  ["read", { is_read: true }],
  ["unread", { is_read: false }],
  ["archive", { is_archived: true, is_read: true }],
  ["unarchive", { is_archived: false }],
] as Array<[string, Record<string, unknown>]>) {
  router.post(`/:id/${path}`, authMiddleware, gate, async (req: AuthenticatedRequest, res) => {
    try {
      const { id } = req.params;
      if (!isValidUUID(id)) { res.status(400).json({ error: "Invalid reply ID" }); return; }
      const { data, error } = await setFlags(req.userId!, id, patch);
      if (error || !data) { res.status(404).json({ error: "Reply not found" }); return; }
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Failed to update reply" });
    }
  });
}

// PUT /api/inbox/:id/classification — manual override (re-runs the side effects)
router.put("/:id/classification", authMiddleware, gate, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    if (!isValidUUID(id)) { res.status(400).json({ error: "Invalid reply ID" }); return; }
    const classification = String(req.body?.classification || "");
    if (!REPLY_CLASSIFICATIONS.includes(classification as ReplyClassification)) {
      res.status(400).json({ error: "Invalid classification" });
      return;
    }
    const returnDate = typeof req.body?.returnDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.body.returnDate) ? req.body.returnDate : null;

    const { data: reply } = await supabase
      .from("replies")
      .select("id, user_id, email_id, lead_id, campaign_id, from_email, classification, direction")
      .eq("id", id)
      .eq("user_id", req.userId)
      .single();
    if (!reply || reply.direction !== "inbound") { res.status(404).json({ error: "Reply not found" }); return; }

    const previous = reply.classification;
    await supabase
      .from("replies")
      .update({
        classification,
        classification_confidence: 1,
        classified_by: "user",
        classification_reason: "Set manually",
        ooo_return_date: classification === "out_of_office" ? returnDate : null,
      })
      .eq("id", id);

    if (previous !== classification) {
      await applyClassificationEffects(reply, {
        classification: classification as ReplyClassification,
        returnDate,
        isHardBounce: classification === "bounce" ? !!req.body?.isHardBounce : false,
      }, previous);
    }
    auditLog({ userId: req.userId, action: "inbox.classify", resource: "replies", resourceId: id, req, metadata: { from: previous, to: classification } });
    res.json({ success: true, classification });
  } catch (err) {
    logger.error({ err }, "Classification override failed");
    res.status(500).json({ error: "Failed to update classification" });
  }
});

// PUT /api/inbox/:id/resume-date — user sets when a paused (out-of-office) sequence resumes.
// Body: { returnDate: "YYYY-MM-DD" } = the day the lead is back; follow-ups go out that day.
router.put("/:id/resume-date", authMiddleware, gate, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    if (!isValidUUID(id)) { res.status(400).json({ error: "Invalid reply ID" }); return; }
    const returnDate = String(req.body?.returnDate || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(returnDate) || Number.isNaN(new Date(`${returnDate}T00:00:00Z`).getTime())) {
      res.status(400).json({ error: "A valid date (YYYY-MM-DD) is required" });
      return;
    }

    const { data: reply } = await supabase
      .from("replies")
      .select("id, lead_id, campaign_id, classification, direction")
      .eq("id", id)
      .eq("user_id", req.userId)
      .single();
    if (!reply || reply.direction !== "inbound") { res.status(404).json({ error: "Reply not found" }); return; }
    if (reply.classification !== "out_of_office") {
      res.status(400).json({ error: "Only out-of-office replies have a resume date" });
      return;
    }

    await supabase.from("replies").update({ ooo_return_date: returnDate }).eq("id", id);
    const moved = await pauseSequenceForLead(reply.lead_id, reply.campaign_id, returnDate, true);
    auditLog({ userId: req.userId, action: "inbox.classify", resource: "replies", resourceId: id, req, metadata: { resumeDate: returnDate, moved } });
    res.json({ success: true, returnDate, moved });
  } catch (err) {
    logger.error({ err }, "Resume date update failed");
    res.status(500).json({ error: "Failed to update resume date" });
  }
});

// POST /api/inbox/:id/reply — send a reply from the same account, threaded, untracked
router.post("/:id/reply", authMiddleware, gate, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    if (!isValidUUID(id)) { res.status(400).json({ error: "Invalid reply ID" }); return; }
    const body = String(req.body?.body || "").trim();
    if (body.length < 2) { res.status(400).json({ error: "Reply text is required" }); return; }
    if (body.length > 20000) { res.status(400).json({ error: "Reply is too long" }); return; }

    const access = await checkSubscriptionAccess(req.userId!);
    if (!access.hasAccess) { res.status(403).json({ error: access.reason }); return; }

    const { data: reply } = await supabase
      .from("replies")
      .select("id, email_id, lead_id, campaign_id, from_email, subject, message_id, direction")
      .eq("id", id)
      .eq("user_id", req.userId)
      .single();
    if (!reply || reply.direction !== "inbound") { res.status(404).json({ error: "Reply not found" }); return; }

    const { data: original } = await supabase
      .from("emails")
      .select("id, subject, to_email, message_id, thread_id, gmail_account_id, smtp_account_id")
      .eq("id", reply.email_id)
      .eq("user_id", req.userId)
      .single();
    if (!original) { res.status(404).json({ error: "Original email not found" }); return; }

    // Same account that sent the original; primary as a fallback if it was removed.
    let account = getAccountInfo(original);
    if (!account) account = await getPrimaryEmailAccountId(req.userId!);
    if (!account) { res.status(400).json({ error: "No email account connected. Connect Gmail or SMTP in Settings first." }); return; }

    // Recipient: the address the lead replied from (falls back to the address we emailed).
    const to = (reply.from_email || original.to_email || "").replace(/[\r\n]/g, "");
    if (!to) { res.status(400).json({ error: "No recipient address" }); return; }

    // Threading: reply to THEIR message; References = our sent chain + their message.
    const { data: chainRows } = await supabase
      .from("emails")
      .select("message_id, sequence_step")
      .eq("lead_id", reply.lead_id)
      .eq("campaign_id", reply.campaign_id)
      .eq("status", "sent")
      .order("sequence_step", { ascending: true });
    const chain = (chainRows || []).map((r: any) => r.message_id).filter(Boolean) as string[];
    if (reply.message_id && !chain.includes(reply.message_id)) chain.push(reply.message_id);

    const baseSubject = (reply.subject || original.subject || "").replace(/^(\s*(re|aw|sv|antw|fwd?)\s*:\s*)+/i, "").trim();
    const subject = `Re: ${baseSubject}`.slice(0, 250);

    const result = await sendEmailUnified(
      account.id,
      account.type,
      to,
      subject,
      body,
      {
        inReplyTo: reply.message_id || original.message_id || undefined,
        references: chain.length ? chain.join(" ") : undefined,
        threadId: account.type === "gmail" ? original.thread_id || undefined : undefined,
      }
      // NO html argument: manual replies go out as plain text with no pixel / tracked links.
    );
    if (!result.success) { res.status(502).json({ error: "Email provider rejected the message" }); return; }

    const { data: stored } = await supabase
      .from("replies")
      .insert({
        email_id: reply.email_id,
        lead_id: reply.lead_id,
        campaign_id: reply.campaign_id,
        user_id: req.userId,
        direction: "outbound",
        from_email: "",
        to_email: to.toLowerCase(),
        subject,
        body_text: body,
        message_id: result.messageId || null,
        in_reply_to: reply.message_id || null,
        received_at: new Date().toISOString(),
        is_read: true,
      })
      .select("id, received_at")
      .single();

    await supabase.from("replies").update({ is_read: true }).eq("id", id);
    auditLog({ userId: req.userId, action: "inbox.reply", resource: "replies", resourceId: id, req, metadata: { to, accountType: account.type } });
    res.json({ message: "Reply sent", sent: { id: stored?.id, subject, body, to, received_at: stored?.received_at, message_id: result.messageId } });
  } catch (err) {
    logger.error({ err }, "Inbox reply send failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to send reply" });
  }
});

export default router;
