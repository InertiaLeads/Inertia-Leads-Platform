import crypto from "crypto";
import supabase from "./supabase";
import logger from "../utils/logger";
import { signTrackingToken } from "../utils/trackingToken";
import { getBackendBaseUrl } from "../utils/unsubscribe";

// =============================================
// Open & click tracking
// =============================================
// Outreach emails are authored and STORED as plain text (the AI prompts, the DB row and the
// app UI never see HTML). At send time only, the outgoing copy is transformed:
//   1. every http(s) link is swapped for a signed redirect on the tracking domain
//   2. a multipart/alternative body is built: the (link-rewritten) text + a minimal HTML
//      mirror of that same text carrying a 1x1 pixel
// The visible link text and the href are the SAME tracked URL in the HTML part. Showing the
// original URL as the anchor text while pointing the href elsewhere is a classic phishing
// pattern that Gmail flags ("this link leads to a different site"), so we never do that.
//
// Tracking URLs live on a dedicated, throwaway subdomain (TRACKING_URL, e.g.
// https://track.example.com → this same Railway service). If that domain is ever flagged
// because of one abusive tenant, it is swapped without touching the app/API/audit domains.

// Matches http(s) URLs in plain text. Trailing sentence punctuation is excluded afterwards
// so "…see https://x.com/report." links to /report and keeps the full stop as text.
const URL_REGEX = /https?:\/\/[^\s<>"'\)\]]+/g;
const TRAILING_PUNCT = /[.,;:!?)]+$/;

export function getTrackingBaseUrl(): string {
  const explicit = process.env.TRACKING_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  return getBackendBaseUrl();
}

// Tracking is only allowed to ship on the dedicated tracking domain. In production, if
// TRACKING_URL is missing, emails go out exactly as V1 sent them (plain text, no pixel, no
// rewritten links) rather than putting tracking links on the app/API domain — one abusive
// tenant could otherwise get that domain flagged for everyone. Local/dev keeps tracking on
// (falls back to BACKEND_URL) so the feature can be tested without DNS.
export function isTrackingEnabled(): boolean {
  if (process.env.TRACKING_URL) return true;
  return process.env.NODE_ENV !== "production";
}

// Extract the ordered list of links in a body — the SAME extraction is used when rewriting
// (send time) and when resolving a click (redirect time), so the index is stable.
export function extractLinks(body: string): string[] {
  const links: string[] = [];
  for (const m of body.matchAll(URL_REGEX)) {
    links.push(m[0].replace(TRAILING_PUNCT, ""));
  }
  return links;
}

function isTrackingUrl(url: string): boolean {
  try {
    const base = new URL(getTrackingBaseUrl());
    const u = new URL(url);
    return u.host === base.host && (u.pathname.startsWith("/t/") || u.pathname.startsWith("/audit/"));
  } catch {
    return false;
  }
}

// Audit-report links keep their short, readable shape — only the host changes:
//   https://app.example.com/audit/AbC123  →  https://track.example.com/audit/AbC123
// The audit token is already unique per lead and unguessable, so it doubles as the click
// token; GET /audit/:token on the tracking host records the click and redirects to the real
// page (routes/tracking.ts → auditClickRedirect).
function shortAuditTrackingUrl(url: string): string | null {
  if (!isAuditUrl(url)) return null;
  try {
    const u = new URL(url);
    return `${getTrackingBaseUrl()}${u.pathname}${u.search}`;
  } catch {
    return null;
  }
}

// Replace each link with its click-tracking redirect. mailto: is untouched (regex never
// matches it). Idempotent: links already on the tracking domain are left alone.
export function rewriteLinks(body: string, emailId: string): string {
  const base = getTrackingBaseUrl();
  let index = -1;
  return body.replace(URL_REGEX, (match) => {
    index += 1;
    if (index > 255) return match; // token index is one byte; absurd for a cold email anyway
    const trailing = match.match(TRAILING_PUNCT)?.[0] || "";
    const clean = match.slice(0, match.length - trailing.length);
    if (isTrackingUrl(clean)) return match;
    const shortAudit = shortAuditTrackingUrl(clean);
    if (shortAudit) return `${shortAudit}${trailing}`;
    const token = signTrackingToken("c", emailId, index);
    if (!token) return match;
    return `${base}/t/c/${token}${trailing}`;
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Minimal HTML mirror of the plain text: no styling, no layout, no images except the pixel.
// Line breaks become <br>, links become anchors whose text IS their href.
export function buildHtmlMirror(text: string, emailId: string): string {
  const base = getTrackingBaseUrl();
  const parts = text.split(URL_REGEX);
  const urls = text.match(URL_REGEX) || [];
  let html = "";
  for (let i = 0; i < parts.length; i++) {
    html += escapeHtml(parts[i]).replace(/\r?\n/g, "<br>\n");
    if (i < urls.length) {
      const raw = urls[i];
      const trailing = raw.match(TRAILING_PUNCT)?.[0] || "";
      const clean = raw.slice(0, raw.length - trailing.length);
      const safe = escapeHtml(clean);
      html += `<a href="${safe}">${safe}</a>${escapeHtml(trailing)}`;
    }
  }
  const openToken = signTrackingToken("o", emailId, 0);
  const pixel = openToken
    ? `<img src="${base}/t/o/${openToken}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;overflow:hidden">`
    : "";
  return `<div>${html}</div>${pixel}`;
}

// Build the outgoing (tracked) representation of a stored plain-text body.
// Returns null-html when tracking can't be applied (e.g. bad email id) so callers fall back
// to the exact plain-text behaviour of before.
export function prepareTrackedEmail(body: string, emailId: string): { text: string; html: string | null } {
  if (!isTrackingEnabled()) {
    return { text: body.trimEnd(), html: null };
  }
  try {
    const text = rewriteLinks(body.trimEnd(), emailId);
    const html = buildHtmlMirror(text, emailId);
    return { text, html };
  } catch (err) {
    logger.warn({ err, emailId }, "Tracking transform failed — sending untracked plain text");
    return { text: body.trimEnd(), html: null };
  }
}

// =============================================
// Event recording (called by the public endpoints)
// =============================================

export function hashIp(rawIp: string, salt: string): string {
  return crypto.createHash("sha256").update(`${rawIp}|${salt}`).digest("hex").slice(0, 16);
}

export function detectDevice(userAgent: string | undefined): "desktop" | "mobile" {
  const ua = (userAgent || "").toLowerCase();
  return /mobile|android|iphone|ipad|ipod/.test(ua) ? "mobile" : "desktop";
}

// Two pixel loads from the same client within this window count once (mail clients often
// fetch the image twice while rendering).
const OPEN_DEDUPE_SECONDS = 120;

interface TrackedEmailRow {
  id: string;
  user_id: string;
  lead_id: string | null;
  campaign_id: string | null;
  status: string;
  body: string;
  sequence_step: number | null;
}

async function loadEmail(emailId: string): Promise<TrackedEmailRow | null> {
  const { data } = await supabase
    .from("emails")
    .select("id, user_id, lead_id, campaign_id, status, body, sequence_step")
    .eq("id", emailId)
    .single();
  return (data as TrackedEmailRow) || null;
}

// Records an open. Returns the email row when a NEW event was stored (so the caller can
// run smart-sequence evaluation), null otherwise. Never throws.
export async function recordOpen(emailId: string, rawIp: string, userAgent: string | undefined): Promise<TrackedEmailRow | null> {
  try {
    const email = await loadEmail(emailId);
    // Only sent emails can be opened. (A pending email's pixel can't have reached anyone.)
    if (!email || email.status !== "sent") return null;

    const ipHash = hashIp(rawIp, emailId);
    const since = new Date(Date.now() - OPEN_DEDUPE_SECONDS * 1000).toISOString();
    const { data: dup } = await supabase
      .from("email_events")
      .select("id")
      .eq("email_id", emailId)
      .eq("event_type", "open")
      .eq("ip_hash", ipHash)
      .gte("created_at", since)
      .limit(1);
    if (dup && dup.length > 0) return null;

    await supabase.from("email_events").insert({
      email_id: emailId,
      user_id: email.user_id,
      event_type: "open",
      ip_hash: ipHash,
      device: detectDevice(userAgent),
    });
    await supabase.rpc("record_email_open", { p_email_id: emailId });
    return email;
  } catch (err) {
    logger.warn({ err, emailId }, "Failed to record open");
    return null;
  }
}

// Resolves the click's destination from the stored body (index-based, see extractLinks)
// and records the event. Returns { url, email } — url is null if it can't be resolved.
export async function recordClick(
  emailId: string,
  linkIndex: number,
  rawIp: string,
  userAgent: string | undefined
): Promise<{ url: string | null; email: TrackedEmailRow | null }> {
  try {
    const email = await loadEmail(emailId);
    if (!email) return { url: null, email: null };

    const links = extractLinks(email.body || "");
    const url = links[linkIndex] || null;
    if (!url || !/^https?:\/\//i.test(url)) return { url: null, email };

    if (email.status === "sent") {
      await supabase.from("email_events").insert({
        email_id: emailId,
        user_id: email.user_id,
        event_type: "click",
        url,
        ip_hash: hashIp(rawIp, emailId),
        device: detectDevice(userAgent),
      });
      await supabase.rpc("record_email_click", { p_email_id: emailId });
      return { url, email };
    }
    return { url, email: null };
  } catch (err) {
    logger.warn({ err, emailId }, "Failed to record click");
    return { url: null, email: null };
  }
}

// Is this URL the lead's personalised audit report? (Highest-intent click signal.)
// Click on the short audit link (track host /audit/:token). The token identifies the LEAD,
// not the email, so the click is credited to the most recent email sent to that lead —
// everything in the UI is counted per lead, so this is invisible in practice.
export async function recordAuditClick(
  auditToken: string,
  rawIp: string,
  userAgent: string | undefined
): Promise<{ email: TrackedEmailRow | null; url: string }> {
  const frontend = (process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/+$/, "");
  const url = `${frontend}/audit/${auditToken}`;
  try {
    const { data: leads } = await supabase
      .from("leads")
      .select("id")
      .eq("enriched_data->>audit_token", auditToken)
      .limit(1);
    const lead = leads && leads[0];
    if (!lead) return { email: null, url };

    const { data: emails } = await supabase
      .from("emails")
      .select("id, user_id, lead_id, campaign_id, status, body, sequence_step")
      .eq("lead_id", lead.id)
      .eq("status", "sent")
      .order("sent_at", { ascending: false })
      .limit(1);
    const email = (emails && emails[0]) as TrackedEmailRow | undefined;
    if (!email) return { email: null, url }; // report link shared outside an email — not a click

    await supabase.from("email_events").insert({
      email_id: email.id,
      user_id: email.user_id,
      event_type: "click",
      url,
      ip_hash: hashIp(rawIp, email.id),
      device: detectDevice(userAgent),
    });
    await supabase.rpc("record_email_click", { p_email_id: email.id });
    return { email, url };
  } catch (err) {
    logger.warn({ err }, "Failed to record audit click");
    return { email: null, url };
  }
}

export function isAuditUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const frontend = process.env.FRONTEND_URL ? new URL(process.env.FRONTEND_URL) : null;
    return u.pathname.startsWith("/audit/") && (!frontend || u.host === frontend.host);
  } catch {
    return false;
  }
}

// =============================================
// Aggregated stats for the campaign page
// =============================================
export interface LeadEngagement {
  opens: number;
  clicks: number;
  lastOpened: string | null;
  lastClicked: string | null;
  hot: boolean;
  flags: { resent: boolean; accelerated: boolean; paused: boolean; cancelled: boolean };
  pausedUntil: string | null; // earliest scheduled_at of a paused, still-pending follow-up
}

export async function getCampaignTrackingStats(userId: string, campaignId: string) {
  const [{ data: campaign }, { data: emails }] = await Promise.all([
    supabase.from("campaigns").select("id, smart_sequences_enabled, smart_sequence_config").eq("id", campaignId).eq("user_id", userId).single(),
    supabase
      .from("emails")
      .select("id, lead_id, status, sequence_step, open_count, click_count, first_opened_at, last_opened_at, last_clicked_at, triggered_by, is_resend, accelerated_at, resent_at, scheduled_at")
      .eq("campaign_id", campaignId)
      .eq("user_id", userId),
  ]);
  if (!campaign) return null;

  const cfg = (campaign.smart_sequence_config || {}) as Record<string, unknown>;
  const hotThreshold = Number(cfg.hot_lead_opens_threshold) > 0 ? Number(cfg.hot_lead_opens_threshold) : 3;

  const rows = emails || [];
  const sent = rows.filter((e) => e.status === "sent");
  const totalSent = sent.length;
  const uniqueOpened = sent.filter((e) => (e.open_count || 0) > 0).length;
  const uniqueClicked = sent.filter((e) => (e.click_count || 0) > 0).length;
  const totalOpens = sent.reduce((s, e) => s + (e.open_count || 0), 0);
  const totalClicks = sent.reduce((s, e) => s + (e.click_count || 0), 0);

  const perLead: Record<string, LeadEngagement> = {};
  for (const e of rows) {
    if (!e.lead_id) continue;
    const cur = perLead[e.lead_id] || {
      opens: 0, clicks: 0, lastOpened: null, lastClicked: null, hot: false,
      flags: { resent: false, accelerated: false, paused: false, cancelled: false },
      pausedUntil: null,
    };
    cur.opens += e.open_count || 0;
    cur.clicks += e.click_count || 0;
    if (e.last_opened_at && (!cur.lastOpened || e.last_opened_at > cur.lastOpened)) cur.lastOpened = e.last_opened_at;
    if (e.last_clicked_at && (!cur.lastClicked || e.last_clicked_at > cur.lastClicked)) cur.lastClicked = e.last_clicked_at;
    if (e.is_resend || e.resent_at) cur.flags.resent = true;
    if (e.accelerated_at) cur.flags.accelerated = true;
    if (e.triggered_by === "paused" && e.status === "pending") {
      cur.flags.paused = true;
      if (e.scheduled_at && (!cur.pausedUntil || e.scheduled_at < cur.pausedUntil)) cur.pausedUntil = e.scheduled_at;
    }
    if (e.triggered_by === "cancelled") cur.flags.cancelled = true;
    perLead[e.lead_id] = cur;
  }
  // "Flag hot leads" is a Smart Sequences trigger: only when the campaign has smart sequences
  // on AND that trigger is on. A click proves the email was opened even when the pixel was
  // blocked, so clicks count toward the hot threshold as well.
  const hotEnabled = !!campaign.smart_sequences_enabled && cfg.hot_lead_flag !== false;
  for (const lead of Object.values(perLead)) {
    lead.hot = hotEnabled && lead.opens + lead.clicks >= hotThreshold;
  }

  const topLeadIds = Object.entries(perLead)
    .map(([leadId, s]) => ({ leadId, score: s.opens + s.clicks * 3 }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((x) => x.leadId);

  let mostEngaged: Array<{ leadId: string; company: string; email: string; opens: number; clicks: number }> = [];
  if (topLeadIds.length > 0) {
    const { data: leads } = await supabase.from("leads").select("id, company, email").in("id", topLeadIds);
    mostEngaged = topLeadIds.map((id) => {
      const l = (leads || []).find((x) => x.id === id);
      return { leadId: id, company: l?.company || "", email: l?.email || "", opens: perLead[id].opens, clicks: perLead[id].clicks };
    });
  }

  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

  return {
    totals: {
      sent: totalSent,
      uniqueOpened,
      uniqueClicked,
      totalOpens,
      totalClicks,
      openRate: pct(uniqueOpened, totalSent),
      clickRate: pct(uniqueClicked, totalSent),
    },
    perLead,
    mostEngaged,
    hotThreshold,
    smartSequencesEnabled: !!campaign.smart_sequences_enabled,
  };
}
