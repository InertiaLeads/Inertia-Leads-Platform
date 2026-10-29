import openai from "./openai";
import supabase from "./supabase";
import logger from "../utils/logger";
import { addSuppression } from "./suppression";
import { pauseSequenceForLead, cancelSequenceForLead } from "./smartSequences";
import { checkAbuseAndAutoPause } from "./abuseGuard";

// =============================================
// AI reply classification + side effects
// =============================================
// Categories and what happens automatically:
//   interested     → highlighted; original marked replied → automated follow-ups stop
//   question       → flagged for manual review; original marked replied → follow-ups stop
//   not_interested → original marked replied; pending follow-ups in the campaign cancelled
//   out_of_office  → NOT a reply; sequence paused until the return date itself when a date is
//                    stated or inferable; with no time hint the schedule is left untouched
//   unsubscribe    → address suppressed for this user (cancels pending everywhere); replied
//   bounce         → NOT a reply; campaign sequence cancelled; hard bounce → suppressed
//
// Note on "interested": V1 already treats ANY reply from a lead as the end of the automated
// sequence (queue + send route + campaign view all cancel pending follow-ups for replied
// leads). Sending an automated "just checking in" after a human said "yes, let's talk" is
// exactly what every outreach tool avoids, so this keeps V1's behaviour. The user replies
// from the Inbox instead.

export type ReplyClassification = "interested" | "not_interested" | "out_of_office" | "unsubscribe" | "question" | "bounce";
export const REPLY_CLASSIFICATIONS: ReplyClassification[] = ["interested", "not_interested", "out_of_office", "unsubscribe", "question", "bounce"];

export interface ClassificationResult {
  classification: ReplyClassification;
  confidence: number;          // 0–1
  returnDate: string | null;   // YYYY-MM-DD, out_of_office only
  isHardBounce: boolean;       // bounce only
  reasoning: string;
  by: "ai" | "heuristic";
}

export interface ReplyForClassification {
  fromEmail: string;
  subject: string;
  bodyText: string;
  originalSubject: string;
  headers?: Record<string, string>; // lower-cased header name → value (auto-submitted, x-autoreply, content-type …)
}

// Remove quoted history so the model only sees what the lead actually wrote.
export function stripQuotedText(text: string): string {
  if (!text) return "";
  let t = text.replace(/\r\n/g, "\n");
  const markers = [
    /^On .{5,120} wrote:\s*$/m,
    /^-{2,}\s*Original Message\s*-{2,}\s*$/mi,
    /^From:\s.+\nSent:\s.+$/m,
    /^_{10,}\s*$/m,
    /^Le .{5,120} a écrit\s*:\s*$/m,
    /^Am .{5,120} schrieb .+:\s*$/m,
    /^El .{5,120} escribió:\s*$/m,
  ];
  let cut = t.length;
  for (const m of markers) {
    const idx = t.search(m);
    if (idx >= 0 && idx < cut) cut = idx;
  }
  t = t.slice(0, cut);
  t = t.split("\n").filter((line) => !line.trimStart().startsWith(">")).join("\n");
  return t.replace(/\n{3,}/g, "\n\n").trim();
}

const BOUNCE_FROM = /mailer-daemon|postmaster|mail delivery|maildelivery|bounce/i;
const BOUNCE_SUBJECT = /undeliver|delivery (status|failure|has failed|notification)|failure notice|returned mail|mail delivery failed|could not be delivered|delivery incomplete|message blocked/i;
const HARD_BOUNCE_TEXT = /does not exist|no such (user|recipient|mailbox)|user unknown|unknown user|mailbox unavailable|address rejected|recipient rejected|invalid recipient|5\.1\.[0-9]|\b550\b|\b553\b|permanent(ly)? (fail|error)|not found|account (is )?disabled|no longer (in use|active|exists)/i;
const OOO_SUBJECT = /out of (the )?office|automatic reply|auto-?reply|autoreply|autom(atische|atic) antwort|abwesenheit|absence|réponse automatique|respuesta automática|on (annual |vacation |holiday )?leave|away from (the )?office/i;

// Cheap, deterministic checks that catch the unambiguous machine-generated cases before
// spending an OpenAI call. Returns null when the LLM should decide.
export function heuristicClassify(reply: ReplyForClassification): ClassificationResult | null {
  const from = reply.fromEmail.toLowerCase();
  const subject = reply.subject || "";
  const headers = reply.headers || {};
  const body = reply.bodyText || "";
  const contentType = headers["content-type"] || "";
  const autoSubmitted = (headers["auto-submitted"] || "").toLowerCase();

  const looksLikeBounce =
    BOUNCE_FROM.test(from) ||
    BOUNCE_SUBJECT.test(subject) ||
    /multipart\/report/i.test(contentType) ||
    /report-type=delivery-status/i.test(contentType);
  if (looksLikeBounce) {
    return {
      classification: "bounce",
      confidence: 0.92,
      returnDate: null,
      isHardBounce: HARD_BOUNCE_TEXT.test(body),
      reasoning: "Delivery status notification detected from sender/subject/headers",
      by: "heuristic",
    };
  }

  // Auto-replies: header says auto-replied, or the classic subjects. Let the LLM confirm and
  // pull a return date, but bias it (see prompt hint) — return null here.
  void autoSubmitted; void OOO_SUBJECT;
  return null;
}

function isLikelyAutoReply(reply: ReplyForClassification): boolean {
  const headers = reply.headers || {};
  const autoSubmitted = (headers["auto-submitted"] || "").toLowerCase();
  return (
    (autoSubmitted !== "" && autoSubmitted !== "no") ||
    "x-autoreply" in headers ||
    "x-autorespond" in headers ||
    "x-auto-response-suppress" in headers ||
    OOO_SUBJECT.test(reply.subject || "")
  );
}

export async function classifyReply(reply: ReplyForClassification): Promise<ClassificationResult | null> {
  const heuristic = heuristicClassify(reply);
  if (heuristic) return heuristic;

  const text = stripQuotedText(reply.bodyText).slice(0, 3000);
  const today = new Date().toISOString().slice(0, 10);
  const autoHint = isLikelyAutoReply(reply)
    ? "\nHINT: message headers/subject indicate this is an AUTOMATIC reply (likely out_of_office). Verify from the text."
    : "";

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
`You classify replies to B2B cold outreach emails. Return ONLY JSON:
{"classification": "interested" | "not_interested" | "out_of_office" | "unsubscribe" | "question" | "bounce",
 "confidence": number 0-1,
 "return_date": "YYYY-MM-DD" or null,
 "is_hard_bounce": boolean,
 "reasoning": short string}

Definitions:
- interested: wants to learn more, asks for a call/meeting/pricing/proposal, positive intent ("sounds good", "send details", "let's talk").
- not_interested: declines, "no thanks", "we're all set", "already have someone", "not now" WITHOUT asking to stop all emails.
- out_of_office: automatic away/vacation/leave notice. ALWAYS try to fill return_date:
  * An explicit date ("back on 6 October", "until Monday 10/6") → that date.
  * A vague period → the EARLIEST sensible date, never the latest: "tomorrow" → tomorrow; "Monday"/"next week" → the coming Monday; "next month" → the 1st of next month; "in two weeks" → today + 14 days; "end of the month" → the last day of this month; "after the holidays" → the first weekday after the holiday period.
  * Only return null when there is truly no time hint at all.
  Being early is cheap (one extra email); being late loses a warm lead.
- unsubscribe: explicitly asks to stop emailing / remove / "STOP" / "unsubscribe" / "don't contact me again" / legal threats about spam.
- question: asks something (who are you, how did you find us, what exactly do you do, is this a scam) without clear yes/no intent.
- bounce: delivery failure / mailbox not found notification. is_hard_bounce=true when the address does not exist or is permanently rejected.

The reply may be in any language. Be decisive; use confidence < 0.6 only when genuinely ambiguous.`,
        },
        {
          role: "user",
          content:
`Today's date: ${today}
Our outreach email subject: ${reply.originalSubject.slice(0, 200)}
Reply from: ${reply.fromEmail}
Reply subject: ${(reply.subject || "").slice(0, 200)}${autoHint}

Reply text:
"""
${text || "(empty)"}
"""`,
        },
      ],
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const cls = String(parsed.classification || "").toLowerCase() as ReplyClassification;
    if (!REPLY_CLASSIFICATIONS.includes(cls)) return null;
    const conf = Number(parsed.confidence);
    const rd = typeof parsed.return_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.return_date) ? parsed.return_date : null;
    return {
      classification: cls,
      confidence: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0.5,
      returnDate: cls === "out_of_office" ? rd : null,
      isHardBounce: cls === "bounce" ? !!parsed.is_hard_bounce : false,
      reasoning: String(parsed.reasoning || "").slice(0, 500),
      by: "ai",
    };
  } catch (err) {
    logger.warn({ err }, "Reply classification failed");
    return null;
  }
}

// =============================================
// Side effects
// =============================================
export interface ReplyRowForEffects {
  id: string;
  user_id: string;
  email_id: string;
  lead_id: string;
  campaign_id: string;
  from_email: string;
  classification: string | null;
}

async function markOriginalReplied(emailId: string): Promise<void> {
  await supabase
    .from("emails")
    .update({ replied: true, replied_at: new Date().toISOString() })
    .eq("id", emailId)
    .eq("replied", false);
}

// Apply (or re-apply, on manual override) the consequences of a classification.
// `previous` is the classification being replaced (manual override only).
export async function applyClassificationEffects(
  reply: ReplyRowForEffects,
  result: { classification: ReplyClassification | null; returnDate: string | null; isHardBounce: boolean },
  previous: string | null = null
): Promise<void> {
  const { classification } = result;

  // Manual correction away from a wrong "unsubscribe": lift the suppression we added.
  // (Cancelled emails stay cancelled — we can't un-send; the user can re-generate.)
  if (previous === "unsubscribe" && classification !== "unsubscribe") {
    await supabase
      .from("email_suppressions")
      .delete()
      .eq("user_id", reply.user_id)
      .eq("email", reply.from_email.toLowerCase())
      .eq("reason", "unsubscribe_reply");
  }

  switch (classification) {
    case "interested":
    case "question":
      await markOriginalReplied(reply.email_id);
      await cancelSequenceForLead(reply.lead_id, reply.campaign_id, "lead replied", false);
      break;

    case "not_interested":
      await markOriginalReplied(reply.email_id);
      await cancelSequenceForLead(reply.lead_id, reply.campaign_id, "not_interested", true);
      break;

    case "unsubscribe": {
      await markOriginalReplied(reply.email_id);
      // Suppress the LEAD's address (the one we emailed), not necessarily the From header —
      // a lead may reply from an alias. Fall back to the From address.
      const { data: original } = await supabase.from("emails").select("to_email").eq("id", reply.email_id).single();
      const address = (original?.to_email || reply.from_email || "").toLowerCase();
      if (address) await addSuppression(reply.user_id, address, "unsubscribe_reply", reply.lead_id);
      if (reply.from_email && reply.from_email.toLowerCase() !== address) {
        await addSuppression(reply.user_id, reply.from_email, "unsubscribe_reply", reply.lead_id);
      }
      await cancelSequenceForLead(reply.lead_id, reply.campaign_id, "unsubscribe", true);
      await checkAbuseAndAutoPause(reply.user_id);
      break;
    }

    case "out_of_office":
      // Pause only when we know (or could infer) when they are back. With no time hint at all
      // the follow-ups simply keep their normal schedule — same as if the notice never came.
      if (result.returnDate) await pauseSequenceForLead(reply.lead_id, reply.campaign_id, result.returnDate);
      break;

    case "bounce": {
      await cancelSequenceForLead(reply.lead_id, reply.campaign_id, "bounce", true);
      if (result.isHardBounce) {
        const { data: original } = await supabase.from("emails").select("to_email").eq("id", reply.email_id).single();
        if (original?.to_email) await addSuppression(reply.user_id, original.to_email, "bounce", reply.lead_id);
      }
      await checkAbuseAndAutoPause(reply.user_id);
      break;
    }

    default:
      // Unclassified (model unavailable): safest assumption is "a human wrote back" —
      // stop the automated sequence, surface it in the inbox for review.
      await markOriginalReplied(reply.email_id);
      await cancelSequenceForLead(reply.lead_id, reply.campaign_id, "lead replied", false);
  }
}

// Classify a freshly-ingested reply row and persist + apply the result. Never throws.
export async function classifyAndApply(reply: ReplyRowForEffects, input: ReplyForClassification): Promise<void> {
  try {
    const result = await classifyReply(input);
    await supabase
      .from("replies")
      .update({
        classification: result?.classification || null,
        classification_confidence: result ? result.confidence : null,
        classification_reason: result?.reasoning || (result ? null : "Classifier unavailable — review manually"),
        classified_by: result?.by || null,
        ooo_return_date: result?.returnDate || null,
      })
      .eq("id", reply.id);

    await applyClassificationEffects(reply, {
      classification: result?.classification || null,
      returnDate: result?.returnDate || null,
      isHardBounce: result?.isHardBounce || false,
    });
    logger.info({ replyId: reply.id, classification: result?.classification || "unclassified", by: result?.by }, "Reply classified");
  } catch (err) {
    logger.error({ err, replyId: reply.id }, "classifyAndApply failed");
  }
}
