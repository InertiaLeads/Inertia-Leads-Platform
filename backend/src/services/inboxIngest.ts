import supabase from "./supabase";
import logger from "../utils/logger";
import type { FetchedMessage, ImapCredentialRow } from "./imap";
import { classifyAndApply } from "./replyClassifier";

// =============================================
// Inbound message → reply row
// =============================================
// Matches an IMAP message to one of OUR sent emails and stores it in `replies`.
// Matching order:
//   1. In-Reply-To / References header ↔ emails.message_id (SMTP-sent emails; nodemailer
//      reports the real Message-ID)
//   2. In-Reply-To / References ↔ replies.message_id of our OUTBOUND inbox replies
//      (the lead answered our manual reply — the thread continues)
//   3. Gmail thread id ↔ emails.thread_id. REQUIRED for Gmail-sent emails: the Gmail API
//      replaces the Message-ID we stamp with its own, so the lead's reply quotes an id we
//      never saw. The thread id from the send response IS reliable, and Gmail exposes the
//      same id over IMAP (X-GM-THRID).
//   4. Sender + subject: the message is from the lead's address and its subject (Re:/Fwd:
//      stripped) equals a subject we sent them. Provider-agnostic safety net.
//   5. Bounce notifications: scan the raw message (incl. attached original headers) for any
//      Message-ID we sent — DSNs almost never carry In-Reply-To.
// Anything that matches nothing is ignored — it is ordinary mail in the user's inbox.

const MSGID_TOKEN = /<[^<>\s@]+@[^<>\s]+>/g;

function normalizeId(id: string): string {
  return id.trim().replace(/^<|>$/g, "").toLowerCase();
}

function idVariants(ids: string[]): string[] {
  const out = new Set<string>();
  for (const raw of ids) {
    const bare = normalizeId(raw);
    if (!bare) continue;
    out.add(`<${bare}>`);
    out.add(bare);
  }
  return [...out];
}

function headerMap(parsed: FetchedMessage["parsed"]): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (const [k, v] of parsed.headers) {
      if (typeof v === "string") out[k.toLowerCase()] = v;
      else if (v && typeof v === "object" && "value" in v) out[k.toLowerCase()] = String((v as { value: unknown }).value ?? "");
      else if (Array.isArray(v)) out[k.toLowerCase()] = v.map(String).join(", ");
    }
  } catch { /* ignore */ }
  return out;
}

function looksLikeBounce(from: string, subject: string, headers: Record<string, string>): boolean {
  return (
    /mailer-daemon|postmaster/i.test(from) ||
    /undeliver|delivery (status|failure|has failed|notification)|failure notice|returned mail|could not be delivered/i.test(subject) ||
    /multipart\/report|report-type=delivery-status/i.test(headers["content-type"] || "")
  );
}

interface MatchedTarget {
  email_id: string;
  lead_id: string;
  campaign_id: string;
  user_id: string;
  subject: string;
}

async function matchToSentEmail(userId: string, msg: FetchedMessage, headers: Record<string, string>): Promise<MatchedTarget | null> {
  const parsed = msg.parsed;
  const refs: string[] = [];
  if (parsed.inReplyTo) refs.push(parsed.inReplyTo);
  if (parsed.references) refs.push(...(Array.isArray(parsed.references) ? parsed.references : [parsed.references]));
  const candidates = idVariants(refs).slice(0, 40);

  if (candidates.length > 0) {
    const { data: emails } = await supabase
      .from("emails")
      .select("id, lead_id, campaign_id, user_id, subject")
      .eq("user_id", userId)
      .in("message_id", candidates)
      .limit(1);
    const e = emails && emails[0];
    if (e && e.lead_id && e.campaign_id) return { email_id: e.id, lead_id: e.lead_id, campaign_id: e.campaign_id, user_id: e.user_id, subject: e.subject };

    const { data: ours } = await supabase
      .from("replies")
      .select("email_id, lead_id, campaign_id, user_id, subject")
      .eq("user_id", userId)
      .eq("direction", "outbound")
      .in("message_id", candidates)
      .limit(1);
    const r = ours && ours[0];
    if (r) return { email_id: r.email_id, lead_id: r.lead_id, campaign_id: r.campaign_id, user_id: r.user_id, subject: r.subject };
  }

  const from = (parsed.from?.value?.[0]?.address || "").toLowerCase();

  // 3. Gmail thread match (see header comment). Prefer the most recent sent email in the
  //    thread so a reply to follow-up #2 attaches to follow-up #2.
  if (msg.gmailThreadId) {
    const { data: inThread } = await supabase
      .from("emails")
      .select("id, lead_id, campaign_id, user_id, subject")
      .eq("user_id", userId)
      .eq("thread_id", msg.gmailThreadId)
      .eq("status", "sent")
      .order("sent_at", { ascending: false })
      .limit(1);
    const e = inThread && inThread[0];
    if (e && e.lead_id && e.campaign_id) return { email_id: e.id, lead_id: e.lead_id, campaign_id: e.campaign_id, user_id: e.user_id, subject: e.subject };
  }

  // 4. Sender + subject fallback: from the address we emailed, same subject once Re:/Fwd:
  //    prefixes are stripped on both sides.
  if (from && parsed.subject) {
    const norm = (s: string) => s.replace(/^(\s*(re|aw|sv|antw|fwd?|wg|tr)\s*:\s*)+/i, "").replace(/\s+/g, " ").trim().toLowerCase();
    const wanted = norm(parsed.subject);
    if (wanted.length >= 4) {
      const { data: toLead } = await supabase
        .from("emails")
        .select("id, lead_id, campaign_id, user_id, subject, sent_at")
        .eq("user_id", userId)
        .eq("status", "sent")
        .ilike("to_email", from)
        .order("sent_at", { ascending: false })
        .limit(20);
      const e = (toLead || []).find((row) => row.subject && norm(row.subject) === wanted);
      if (e && e.lead_id && e.campaign_id) return { email_id: e.id, lead_id: e.lead_id, campaign_id: e.campaign_id, user_id: e.user_id, subject: e.subject };
    }
  }

  // 5. Bounce path: look for any of our Message-IDs anywhere in the raw message.
  if (looksLikeBounce(from, parsed.subject || "", headers)) {
    const tokens = new Set<string>();
    for (const m of msg.raw.matchAll(MSGID_TOKEN)) {
      const bare = normalizeId(m[0]);
      if (parsed.messageId && bare === normalizeId(parsed.messageId)) continue;
      tokens.add(bare);
      if (tokens.size >= 60) break;
    }
    if (tokens.size > 0) {
      const { data: emails } = await supabase
        .from("emails")
        .select("id, lead_id, campaign_id, user_id, subject")
        .eq("user_id", userId)
        .in("message_id", idVariants([...tokens]))
        .limit(1);
      const e = emails && emails[0];
      if (e && e.lead_id && e.campaign_id) return { email_id: e.id, lead_id: e.lead_id, campaign_id: e.campaign_id, user_id: e.user_id, subject: e.subject };
    }
  }
  return null;
}

// Returns true when a NEW reply row was stored.
export async function ingestMessage(cred: ImapCredentialRow, msg: FetchedMessage): Promise<boolean> {
  const parsed = msg.parsed;
  const headers = headerMap(parsed);
  const fromEmail = (parsed.from?.value?.[0]?.address || "").toLowerCase();

  // Our own outgoing mail can show up in INBOX on some providers (e.g. Sent-copy rules).
  if (fromEmail && fromEmail === cred.email.toLowerCase()) return false;

  const target = await matchToSentEmail(cred.user_id, msg, headers);
  if (!target) return false;

  const messageId = parsed.messageId ? normalizeId(parsed.messageId) : `imap-${cred.id}-${msg.uid}`;
  const receivedAt = parsed.date || msg.internalDate || new Date();
  const bodyText = (parsed.text || "").slice(0, 50000);
  const bodyHtml = typeof parsed.html === "string" ? parsed.html.slice(0, 200000) : null;
  const toEmail = Array.isArray(parsed.to) ? parsed.to[0]?.value?.[0]?.address || "" : parsed.to?.value?.[0]?.address || "";

  const { data: inserted, error } = await supabase
    .from("replies")
    .upsert(
      {
        email_id: target.email_id,
        lead_id: target.lead_id,
        campaign_id: target.campaign_id,
        user_id: target.user_id,
        direction: "inbound",
        from_email: fromEmail,
        to_email: toEmail.toLowerCase(),
        subject: (parsed.subject || "").slice(0, 500),
        body_text: bodyText,
        body_html: bodyHtml,
        message_id: `<${messageId}>`,
        in_reply_to: parsed.inReplyTo || null,
        received_at: receivedAt.toISOString(),
        imap_credential_id: cred.id,
      },
      { onConflict: "user_id,message_id", ignoreDuplicates: true }
    )
    .select("id, user_id, email_id, lead_id, campaign_id, from_email, classification");

  if (error) {
    logger.warn({ error: error.message, credentialId: cred.id, uid: msg.uid }, "Failed to store reply");
    return false;
  }
  const row = inserted && inserted[0];
  if (!row) return false; // duplicate — already ingested earlier

  logger.info({ replyId: row.id, leadId: row.lead_id, campaignId: row.campaign_id, from: fromEmail }, "Reply ingested");

  // Classification decides whether this counts as a human reply (marks the original replied,
  // stops follow-ups) or a machine notice (bounce / out of office).
  await classifyAndApply(row, {
    fromEmail,
    subject: parsed.subject || "",
    bodyText,
    originalSubject: target.subject || "",
    headers,
  });
  return true;
}
