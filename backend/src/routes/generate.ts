import { Router } from "express";
import crypto from "crypto";
import { authMiddleware, AuthenticatedRequest } from "../middleware/auth";
import supabase from "../services/supabase";
import openai from "../services/openai";
import { checkDailyGenerationLimit, PLAN_CONFIGS, getUserPlan, reserveGenerationsToday, releaseGenerationsToday, ServiceType, getFeatureAccess } from "../services/planLimits";
import { getPageSpeedScores } from "../services/pageSpeed";
import { getLanguageName } from "../utils/languageDetection";
import { buildUnsubscribeUrl } from "../utils/unsubscribe";
import { getSuppressedEmails } from "../services/suppression";
import logger from "../utils/logger";

const router = Router();

// Sanitize user-supplied data before injecting into AI prompts
// Strips instruction-like patterns that could manipulate the AI
function sanitizeForPrompt(value: string): string {
  if (!value) return "";
  return value
    // Remove common prompt injection patterns
    .replace(/ignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?)/gi, "")
    .replace(/you\s+are\s+now/gi, "")
    .replace(/system\s*:/gi, "")
    .replace(/\bprompt\s*:/gi, "")
    .replace(/\bassistant\s*:/gi, "")
    .replace(/\bhuman\s*:/gi, "")
    .replace(/\buser\s*:/gi, "")
    // Remove attempts to close/open JSON or code blocks
    .replace(/```/g, "")
    .replace(/\{\s*"role"/gi, "")
    // Limit length to prevent prompt stuffing
    .slice(0, 300)
    .trim();
}

// Helper: process items in parallel batches
async function processBatch<T, R>(
  items: T[],
  batchSize: number,
  fn: (item: T) => Promise<R | null>
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fn));
    for (const r of batchResults) {
      if (r !== null) results.push(r);
    }
  }
  return results;
}

const PARALLEL_BATCH_SIZE = 5;

// Helper: random integer between min and max (inclusive)
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Helper: calculate follow-up date with random delay range
function calculateFollowUpDate(minDays: number, maxDays: number): string {
  const days = randInt(minDays, maxDays);
  const hours = randInt(0, 12); // Add random hours for natural timing
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(date.getHours() + hours);
  return date.toISOString();
}

// ===== PROMPT VARIATIONS =====
// 3 distinct tones randomly assigned per lead to avoid pattern detection

type ToneKey = "friendly" | "direct" | "curious";
const TONES: ToneKey[] = ["friendly", "direct", "curious"];

function pickTone(): ToneKey {
  return TONES[Math.floor(Math.random() * TONES.length)];
}

// Opt-out line variants — rotated per email so the closing isn't a byte-identical
// signature across a whole campaign (an identical footer is a strong bulk fingerprint).
// Each carries the recipient's one-click unsubscribe link (CAN-SPAM compliance).
// The URL is rendered as a clickable "Unsubscribe" word in the HTML email, so the
// intro deliberately omits the word "unsubscribe" (it would otherwise read twice).
const OPT_OUT_VARIANTS = [
  (url: string) => `Not relevant? ${url}`,
  (url: string) => `If this isn't for you: ${url}`,
  (url: string) => `Rather not get these? ${url}`,
  (url: string) => `Not interested? ${url}`,
  (url: string) => `Prefer I stop reaching out? ${url}`,
];

// Append the opt-out line (with the recipient's unsubscribe link) to the email body.
function appendOptOut(body: string, unsubscribeUrl: string): string {
  const optOut = OPT_OUT_VARIANTS[Math.floor(Math.random() * OPT_OUT_VARIANTS.length)](unsubscribeUrl);
  return body.trimEnd() + "\n\n" + optOut;
}

// Build the sender's signature block from their saved profile (CAN-SPAM sender
// identity + physical postal address). Returns "" if nothing is set.
//   Best regards,
//   <Full Name>
//   <Company>        (optional)
//   <Business Address>
async function getSenderSignature(userId: string): Promise<string> {
  try {
    const { data, error } = await supabase.auth.admin.getUserById(userId);
    if (error || !data?.user) return "";
    const meta = (data.user.user_metadata || {}) as Record<string, string>;
    const name = (meta.full_name || "").trim();
    const company = (meta.company_name || "").trim();
    const address = (meta.business_address || "").trim();
    if (!name && !company && !address) return "";
    const lines: string[] = ["Best regards,"];
    if (name) lines.push(name);
    if (company) lines.push(company);
    if (address) lines.push(address);
    return lines.join("\n");
  } catch {
    return "";
  }
}

// Append the sender's signature block to the body (placed before the opt-out line).
function appendSignature(body: string, signature: string): string {
  if (!signature) return body;
  return body.trimEnd() + "\n\n" + signature;
}

// Distinct email STRUCTURES, rotated per lead. The point is genuine shape variation
// (length, opening move, whether there's social proof) — not just different words —
// so a mass send doesn't collapse into one spam-detectable template fingerprint.
const STRUCTURE_VARIANTS: string[] = [
  `Ultra-short. 2-3 sentences total: one specific thing you noticed, one line on why it costs them, one genuine question. No link fluff, no story.`,
  `Question-first. Open with a real question about the specific problem you found, THEN explain what you saw, then stop. Don't wrap it in a pitch.`,
  `Single-observation. Lead with the one most surprising thing you found, spend exactly one line on why it matters to their customers, end abruptly with a question.`,
  `Observation → consequence → soft offer. State the problem plainly, connect it to a real-world consequence in one sentence, then offer to share what you found. No urgency.`,
  `Conversational note. Write it like a quick message you'd dash off to an acquaintance — slightly informal, one clear point, a casual closing question. Vary sentence length naturally.`,
  `Contrast. Frame it as "solid business, odd gap" — acknowledge something fine about them, point out the one thing that doesn't fit, then ask about it.`,
];

function pickStructure(): string {
  return STRUCTURE_VARIANTS[Math.floor(Math.random() * STRUCTURE_VARIANTS.length)];
}

function buildInitialPrompt(lead: any, tone: ToneKey, enriched?: { summary?: string; issues?: string; digitalGaps?: string; noWebsite?: boolean; brokenWebsite?: boolean; auditUrl?: string }, serviceType: ServiceType = "web_dev", language: string = "eng"): string {
  const company = sanitizeForPrompt(lead.company);
  const industry = sanitizeForPrompt(lead.industry || "Local business");
  const address = sanitizeForPrompt(lead.enriched_data?.address || "");
  const contactName = sanitizeForPrompt(lead.name || "");
  const website = sanitizeForPrompt(lead.website || "");
  const hasNoWebsite = enriched?.noWebsite || (!lead.website || !lead.website.startsWith("http"));
  const hasBrokenWebsite = enriched?.brokenWebsite || false;

  // Sanitize enrichment data too
  const enrichedSummary = enriched?.summary ? sanitizeForPrompt(enriched.summary) : "";
  const enrichedIssues = enriched?.issues ? sanitizeForPrompt(enriched.issues) : "";
  const enrichedGaps = enriched?.digitalGaps ? sanitizeForPrompt(enriched.digitalGaps) : "";

  // Extract city from address for hyper-local references
  const city = address ? address.split(",")[0].trim() : "";

  let context: string;
  if (hasNoWebsite) {
    context = `Industry: ${industry}${city ? `\nCity: ${city}` : ""}${address ? `\nFull address: ${address}` : ""}
⚠️ THIS BUSINESS HAS NO WEBSITE — only a Google listing with a phone number.
What this means:
- When someone in ${city || "their area"} Googles "${industry.toLowerCase()} near me", this business will never show up in organic results
- Every potential customer goes to a competitor who HAS a website
- They are completely invisible online — no way for anyone to check their services, prices, or reviews before calling`;
  } else if (hasBrokenWebsite) {
    context = `Industry: ${industry}${city ? `\nCity: ${city}` : ""}${address ? `\nFull address: ${address}` : ""}
⚠️ BROKEN WEBSITE — ${website} is down or unreachable.
What this means:
- Anyone searching for them online right now sees an error page
- A broken site is worse than no site — it screams "this business is closed" to customers
- Every day it stays broken, they lose walk-in and phone customers who check online first`;
  } else if (enriched) {
    context = `Industry: ${industry}${city ? `\nCity: ${city}` : ""}${address ? `\nFull address: ${address}` : ""}\nWebsite: ${website}\nWhat their site does: ${enrichedSummary}`;
    if (enrichedGaps) {
      context += `\nSpecific problems found on their site:\n${enrichedGaps}`;
    }
    if (enrichedIssues) {
      context += `\nTechnical issues: ${enrichedIssues}`;
    }
    if ((serviceType === "digital_marketing" || serviceType === "social_media") && lead.enriched_data) {
      const rating = lead.enriched_data.googleRating;
      const reviewCount = lead.enriched_data.googleReviewCount;
      if (rating !== undefined) context += `\nGoogle Rating: ${rating}/5 (${reviewCount || 0} reviews)`;
      if (lead.enriched_data.hasGoogleAds === false) context += `\nNot running Google Ads`;
      if (lead.enriched_data.hasFacebookPixel === false) context += `\nNo Facebook/Meta Pixel (not retargeting visitors)`;
      if (lead.enriched_data.hasAnalytics === false) context += `\nNo Google Analytics (flying blind — no visitor data)`;
    }
  } else {
    context = `Industry: ${industry}${city ? `\nCity: ${city}` : ""}${address ? `\nFull address: ${address}` : ""}\nWebsite: ${website || "N/A"}\nContact: ${contactName}`;
  }

  const toneInstructions: Record<ToneKey, string> = {
    friendly: `TONE: Write like a genuinely helpful person who noticed something and wants to point it out — zero sales pressure. Think "friendly local expert who saw something and couldn't NOT say something." Use contractions, conversational fragments. Sound human.`,

    direct: `TONE: Write like someone who's busy, confident, and doesn't waste words. No fluff, no pleasantries — get straight to the point. Think "friend who shoots you a quick text about something important." Short sentences, punchy.`,

    curious: `TONE: Write like someone who's genuinely puzzled by what they found. Not pitching — just confused why a clearly good business has this obvious problem. Think "wait, this doesn't make sense for a business like yours." Questions feel authentic, not selling.`,
  };

  // Service-specific writing approach
  const serviceApproach: Record<ServiceType, string> = {
    web_dev: `YOUR ANGLE: You build websites for local ${industry.toLowerCase()} businesses${city ? ` in ${city}` : ""}.

WRITING STRUCTURE:
1. OPEN with ONE hyper-specific thing wrong with their site that the reader can verify in 10 seconds. Not "your site has issues" — describe the EXACT problem: what page, what element, what happens. If their site is not mobile-friendly, tell them to pull it up on their phone and describe what they'll see. If the loading time is bad, tell them to try loading it and count the seconds. The reader should think "wait, let me go check that right now."
2. CONNECT to real-world consequences in ONE sentence — how does this specific thing cost them customers? Be concrete: "That means anyone searching '${industry.toLowerCase()} in ${city || "your area"}' on their phone bounces within 3 seconds."
3. SOCIAL PROOF in ONE casual sentence — reference a real-sounding result with a specific ${industry.toLowerCase()} (not by name): "Fixed this exact thing for a ${industry.toLowerCase()} down the road — their online bookings went from 2/week to 11." Use realistic, SMALL numbers. Never say "doubled" or "tripled."
4. END with a specific question they want to answer — not "want to chat?" but something about their specific situation: "Out of curiosity — do you know what your site looks like on an iPhone right now?"`,

    seo: `YOUR ANGLE: You do SEO for local ${industry.toLowerCase()} businesses${city ? ` in ${city}` : ""}.

WRITING STRUCTURE:
1. OPEN with a specific, verifiable ON-SITE issue you found on their website. This must be based ONLY on the enrichment data provided (missing meta descriptions, slow loading, not mobile-friendly, no schema markup, no SSL, thin content, poor heading structure, missing alt tags, outdated platform, etc.). Tell them exactly what you found — make it visceral: "Pulled up ${company}'s site on my phone — took 6 seconds to load and the text was unreadable without zooming."
2. FEAR — Connect this issue DIRECTLY to Google's ranking algorithm. Be blunt and scary: explain that Google actively pushes sites with this exact problem DOWN in search results. Their competitors who DON'T have this problem are stealing their spot. People searching "${industry.toLowerCase()} ${city || "near me"}" right now are clicking on competitors instead because Google is burying sites with these issues. Frame it as: this isn't a future risk — it's happening RIGHT NOW, every single day. Customers searching for exactly what they offer are going to competitors because of this one fixable problem.
3. SOCIAL PROOF in ONE casual sentence — "I helped a ${industry.toLowerCase()} nearby fix this exact thing — they went from barely visible on Google to the top 3 map results in about 5 weeks." Use realistic, modest numbers and timeframes.
4. END with a fear-triggering question: "Do you know how many people searched '${industry.toLowerCase()} in ${city || "your area"}' this week and ended up at a competitor because of this?" or "Have you checked what Google actually shows people who search for your type of business right now?"

FEAR FRAMEWORK: The structure is: [Real verifiable problem on their site] → [This is EXACTLY what Google penalizes] → [Your competitors don't have this problem, so they get all the customers] → [This is costing you real customers every single day]. Make them feel like every day they don't fix this, money is walking out the door to the business down the street.

IMPORTANT: Do NOT claim you checked their actual rankings or that they don't appear on page 1 — you haven't verified that. Instead, explain that the technical issues you DID find are proven ranking killers according to Google's own algorithm updates. The fear comes from "this problem guarantees you're losing ground to competitors" — not from "I checked and you're not ranking."`,

    digital_marketing: `YOUR ANGLE: You do digital marketing for local ${industry.toLowerCase()} businesses${city ? ` in ${city}` : ""}.

WRITING STRUCTURE:
1. OPEN with a specific, verifiable gap in their marketing setup based on what you found on their site. Reference actual findings: no Google Analytics (flying blind), no Facebook/Meta Pixel (can't retarget), no Google Ads, no email capture forms, no lead nurturing. Example: "Checked ${company}'s site — no tracking pixel, no analytics, no retargeting. Every single visitor who doesn't convert on the first visit is gone forever."
2. FEAR — Connect this gap to what it's costing them RIGHT NOW. Be blunt: their competitors ARE running ads, ARE retargeting visitors, ARE capturing emails — and every person who visits ${company}'s site and leaves is being scooped up by a competitor's retargeting ad within hours. Frame it as: "Right now, someone searches '${industry.toLowerCase()} ${city || "near me"}', visits your site, leaves without calling — and 20 minutes later sees your competitor's ad on Facebook. That customer is gone." Make them feel the daily bleeding of customers they can't see.
3. SOCIAL PROOF in ONE casual sentence — "Set up tracking + retargeting for a ${industry.toLowerCase()} nearby — they went from zero online leads to about 8-12/week within the first month." Use realistic, modest numbers.
4. END with a fear-triggering question: "Do you know how many people visited ${company}'s site this month and left without you ever knowing they existed?" or "Quick question — if 100 people visit your site this month and 95 leave, do you have any way to reach them again?"

FEAR FRAMEWORK: The structure is: [Verified marketing gap on their site] → [Your competitors are doing this and catching YOUR customers] → [Every day without this, you're invisible while competitors retarget your own visitors] → [You're bleeding money you can't even measure]. The fear comes from the INVISIBLE loss — they can't see what they're losing because they don't have tracking.

IMPORTANT: Do NOT claim you checked their ad accounts or competitor ad spend — you haven't. Instead, explain that the gaps you DID find mean they're flying completely blind while competitors with these tools installed are capturing every lead that slips through.`,

    social_media: `YOUR ANGLE: You manage social media for local ${industry.toLowerCase()} businesses${city ? ` in ${city}` : ""}.

WRITING STRUCTURE:
1. OPEN with a specific observation about their social media absence or state. What did you find (or not find) when you looked them up? "Looked up ${company} on Instagram — nothing comes up. For a ${industry.toLowerCase()}, that's like having a storefront with no sign."
2. CONNECT to consequences in ONE sentence — customers check social media before choosing a business. No presence = no trust.
3. SOCIAL PROOF in ONE casual sentence — "Helped a ${industry.toLowerCase()} nearby go from zero social presence to 400+ followers and 5-6 DM inquiries a week in about 2 months." Use realistic, modest numbers.
4. END with a question about how customers find/trust them: "When someone Googles your business, what do they see that makes them choose you over the place down the street?"`,
  };

  // Per-lead structure + social-proof variation, so a campaign of many emails
  // doesn't share one detectable template fingerprint.
  const structure = pickStructure();
  const includeSocialProof = Math.random() < 0.5;

  return `Write a cold email that reads like a personal message, NOT a marketing email.

The reader should feel like a real human noticed something about their business and took 2 minutes to write them about it. The email should feel so personal and specific that they think "this person actually looked at my business" — not "this is a mass email."

${serviceApproach[serviceType]}

STRUCTURE FOR THIS SPECIFIC EMAIL — this OVERRIDES the default step order above. Follow this shape:
${structure}
${includeSocialProof
  ? "Social proof: you MAY include ONE short, realistic result line if it genuinely fits — but vary its wording and where it sits, and never reuse a fixed phrase."
  : "Social proof: do NOT include any 'helped another business' / 'went from X to Y' line in this email. Keep it entirely about THEM."}

LEAD DATA:
Company name: ${company}
Contact name: ${contactName}
${context}

CRITICAL RULES:
- NEVER use placeholder brackets like [City], [Your Name], [Industry], [X%], [Number] — NEVER. If you don't have a piece of data, either use the actual data provided above or skip that detail entirely. Using brackets = immediate fail.
- ${city ? `Use "${city}" as their city — it's confirmed data.` : "Do NOT guess their city. Skip location references if no city is provided."}
- BANNED words/phrases: "revenue", "optimize", "solution", "leverage", "streamline", "maximize", "boost", "transform", "unlock", "empower", "excited", "thrilled", "growth", "scale", "ROI", "synergy", "game-changer", "I was just browsing", "I came across", "I hope this finds you"
- Do NOT start with a greeting ("Hi", "Hey", "Hello", "I hope this"). Start directly with the observation.
- Length: 40-110 words — match the STRUCTURE above (short variants must be genuinely short, not padded to fill space). Every word must earn its place.
- Do NOT use bullet points or numbered lists — this is a personal message, not a report.
- Write in plain English. If your grandmother wouldn't say it in conversation, rewrite it.
- Social proof numbers must be REALISTIC and modest — not "10x", not "doubled revenue", not "hundreds of leads." Think: "went from 2 to 11 bookings/week" or "started getting 5-6 calls a week from Google."
- Every claim must sound like something a small local business would actually experience.
- Leave a blank line (\\n\\n) between paragraphs for readability.
- The closing question must be SO specific to their business that they feel compelled to answer or at least think about it.

SUBJECT LINE RULES:
- Sentence case (capitalize the first letter), 3-6 words
- Must sound like a friend texting about something they noticed — NOT like a marketing email subject
- Include their PROPER company name (exactly as provided, with correct capitalization) when natural
- Create curiosity without being clickbaity
- Vary the subject every send — do NOT fall back to one fixed template. It must feel specific to THIS business.
- GOOD subjects (inspiration only — do NOT copy these verbatim): "noticed something on ${company}'s site", "a quick thought about ${company}", "${city || industry} — one thing"
- Examples of BAD subjects: "Boost Your Business!", "Your Website Needs Help", "Partnership Opportunity"

${toneInstructions[tone]}
${enriched?.auditUrl ? `
AUDIT LINK: ${enriched.auditUrl}
Include this link naturally in the email after mentioning 1-2 specific issues. Introduce it as "a quick snapshot of what I found" or "put together a quick breakdown" — NOT "audit report." The link MUST be on its own line with \\n before it. Do NOT put any punctuation right after the URL. The link should feel like a helpful extra, not the main pitch. Example:
"Here's a quick breakdown of what I found:
${enriched.auditUrl}"` : ""}
${language !== "eng" ? `
LANGUAGE: Write the ENTIRE email (subject line AND body) in ${getLanguageName(language)}. The lead's website is in ${getLanguageName(language)}, so they expect communication in their own language. Write naturally as a native speaker would — do NOT translate from English. Keep the same tone, structure, and rules above but in ${getLanguageName(language)}.` : ""}

Return ONLY a JSON object with "subject" and "body" fields. The body should NOT include a sign-off name or signature.`;
}

function buildFollowup1Prompt(company: string, issues: string, tone: ToneKey, topGap?: string, language: string = "eng"): string {
  const toneStyle: Record<ToneKey, string> = {
    friendly: `TONE: Warm, zero pressure — like texting a friend you haven't heard back from.`,
    direct: `TONE: Brief and matter-of-fact — one quick bump, no fluff.`,
    curious: `TONE: Still thinking about what you noticed — genuinely curious if they checked.`,
  };

  const gapContext = topGap || issues || "their website";

  // Rotate the follow-up angle, subject style, and length per lead so follow-ups
  // don't share one template fingerprint across a campaign.
  const angles = [
    `A quick industry stat — e.g. "looked into this more, a lot of ${company.split(" ")[0].toLowerCase()}-type places nearby have the same gap."`,
    `A new observation you "just noticed" on their site (a form not working on mobile, a slow page, a broken link).`,
    `A competitor reference — "saw a ${gapContext.split(" ")[0].toLowerCase()} nearby just updated theirs, figured you'd want to know."`,
    `One genuinely useful tip they can act on in two minutes, no strings attached.`,
    `An honest, light nudge built around ONE concrete new detail about what you found — zero pressure.`,
  ];
  const angle = angles[Math.floor(Math.random() * angles.length)];

  const subjects = [
    `a reply-style "re:" variation of the original thread`,
    `"one more thing"`,
    `"forgot to mention"`,
    `"quick follow-up"`,
    `"saw this, thought of ${company}"`,
  ];
  const subject = subjects[Math.floor(Math.random() * subjects.length)];

  const wordTarget = ["25-40", "30-50", "35-55"][Math.floor(Math.random() * 3)];

  return `Write a follow-up email that feels like a real person bumping their own thread. NOT a marketing email — a human checking in.

Context:
- You emailed ${company} a few days ago about: ${gapContext}
- No reply yet
- You want to re-engage them WITHOUT re-pitching

APPROACH FOR THIS EMAIL: ${angle}
Add real, NEW value — don't just say "bumping this." Use the angle above; pick this ONE idea and make it natural, don't list several.

Rules:
- ${wordTarget} words — short enough to read in a few seconds
- MUST add something new — a small nugget of value, not just "did you see my last email?"
- End with a casual, specific question
- No marketing language, no formal greetings
- Do NOT use placeholder brackets like [City], [Name], etc.
- Do NOT include a sign-off name or signature

Subject line: ${subject}

${toneStyle[tone]}
${language !== "eng" ? `\nLANGUAGE: Write the ENTIRE email (subject and body) in ${getLanguageName(language)}. Write naturally as a native speaker would.` : ""}

Return ONLY JSON with "subject" and "body" fields.`;
}

function buildFollowup2Prompt(company: string, tone: ToneKey, language: string = "eng"): string {
  const toneStyle: Record<ToneKey, string> = {
    friendly: `TONE: Genuinely no-pressure — like closing a thread with a friend. Zero guilt.`,
    direct: `TONE: Quick, clean close. One sentence, done.`,
    curious: `TONE: Leave them with one final thought-provoking observation.`,
  };

  // Rotate the closing move, subject, and length per lead so the breakup email
  // isn't an identical template across a campaign.
  const finalThoughts = [
    `Leave ONE tiny, specific observation that might stick in their mind.`,
    `End with a single honest line acknowledging they're probably busy, plus a soft "door's open" if they ever want to look.`,
    `Drop one small, genuinely useful tip on the way out — nothing asked in return.`,
    `Close with a light, low-key question they could answer in one word if they ever feel like it.`,
  ];
  const finalThought = finalThoughts[Math.floor(Math.random() * finalThoughts.length)];

  const subjects = [`"closing the loop"`, `"last one from me"`, `"I'll leave it here"`, `"no worries either way"`];
  const subject = subjects[Math.floor(Math.random() * subjects.length)];

  const wordTarget = ["20-35", "25-40"][Math.floor(Math.random() * 2)];

  return `Write a final follow-up that ends the thread naturally. This is the last email — it should feel like a real person wrapping up, not a marketer doing a "last chance!" push.

Context:
- You emailed ${company} twice, no reply
- This is genuinely the last email — you're moving on

APPROACH: Use the "breakup + door open" technique:
- Acknowledge they're busy (NOT guilt-trip)
- ${finalThought}
- Make it clear you won't email again — but the door is open if they want to reach out later

Rules:
- ${wordTarget} words maximum
- Sound like a real person, not a drip sequence
- ZERO pressure, zero urgency tactics, zero "last chance" energy
- The reader should feel GOOD after reading this, not guilty
- Do NOT use placeholder brackets like [City], [Name], etc.
- Do NOT include a sign-off name or signature

Subject line: ${subject}

${toneStyle[tone]}
${language !== "eng" ? `\nLANGUAGE: Write the ENTIRE email (subject and body) in ${getLanguageName(language)}. Write naturally as a native speaker would.` : ""}

Return ONLY JSON with "subject" and "body" fields.`;
}

// ===== AUTO-GENERATE AUDIT TOKEN =====
async function ensureAuditToken(lead: any, serviceType: ServiceType = "web_dev"): Promise<string | undefined> {
  const ed = lead.enriched_data || {};
  // Skip if no enrichment data at all (nothing to show in audit)
  const hasEnrichment = ed.summary || ed.hasOnlineBooking !== undefined || ed.hasContactForm !== undefined || ed.hasSSL !== undefined || ed._siteDown || ed.isParkedDomain;
  if (!hasEnrichment) return undefined;

  // Already has a token — fetch PageSpeed if missing (only for web_dev and seo)
  if (ed.audit_token) {
    const needsPageSpeed = (serviceType === "web_dev" || serviceType === "seo") && !ed.pageSpeed && lead.website && !ed._siteDown && !ed.isParkedDomain;
    if (needsPageSpeed) {
      const pageSpeedData = await getPageSpeedScores(lead.website);
      if (pageSpeedData) {
        await supabase.from("leads")
          .update({ enriched_data: { ...ed, pageSpeed: pageSpeedData, audit_service_type: serviceType } })
          .eq("id", lead.id);
      }
    } else if (!ed.audit_service_type) {
      // Backfill service type for existing tokens
      await supabase.from("leads")
        .update({ enriched_data: { ...ed, audit_service_type: serviceType } })
        .eq("id", lead.id);
    }
    return `${process.env.FRONTEND_URL || "http://localhost:3000"}/audit/${ed.audit_token}`;
  }

  // Generate new token + fetch PageSpeed only for web_dev/seo
  const token = crypto.randomBytes(12).toString("base64url");

  let pageSpeedData = null;
  if ((serviceType === "web_dev" || serviceType === "seo") && lead.website && !ed._siteDown && !ed.isParkedDomain) {
    pageSpeedData = await getPageSpeedScores(lead.website);
  }

  const { error } = await supabase
    .from("leads")
    .update({ enriched_data: { ...ed, audit_token: token, audit_service_type: serviceType, ...(pageSpeedData ? { pageSpeed: pageSpeedData } : {}) } })
    .eq("id", lead.id);

  if (error) {
    logger.error({ leadId: lead.id, error }, "Failed to auto-generate audit token");
    return undefined;
  }

  return `${process.env.FRONTEND_URL || "http://localhost:3000"}/audit/${token}`;
}

// ===== LEAD QUALITY FILTER =====
function isValidLead(lead: any): { valid: boolean; reason?: string } {
  if (!lead.company || lead.company.trim().length < 2) {
    return { valid: false, reason: "no_company" };
  }
  if (!lead.email || !lead.email.includes("@")) {
    return { valid: false, reason: "no_email" };
  }

  const email = lead.email.toLowerCase();
  const [localPart, domain] = email.split("@");

  // Check for obvious junk emails
  const junkPatterns = ["noreply", "no-reply", "donotreply", "test@", "example.com"];
  if (junkPatterns.some(p => email.includes(p))) {
    return { valid: false, reason: "junk_email" };
  }

  // Reject file-like emails (e.g. flags@2x.webp, icon@3x.png)
  const junkExtensions = [".webp", ".png", ".jpg", ".gif", ".svg", ".ico", ".js", ".css", ".json", ".woff", ".woff2", ".ttf"];
  if (junkExtensions.some(ext => email.endsWith(ext))) {
    return { valid: false, reason: "file_extension_email" };
  }

  // Local part too short or only digits
  if (!localPart || localPart.length < 2 || /^\d+$/.test(localPart)) {
    return { valid: false, reason: "invalid_local_part" };
  }

  // Domain too short (e.g. @2x)
  if (!domain || domain.split(".").length < 2 || domain.length < 4) {
    return { valid: false, reason: "invalid_domain" };
  }

  return { valid: true };
}

// ===== CALL SCRIPT GENERATION =====
function buildCallScriptPrompt(lead: any, enriched?: { summary?: string; issues?: string }, language: string = "eng"): string {
  const industry = sanitizeForPrompt(lead.industry || "Local business");
  const address = sanitizeForPrompt(lead.enriched_data?.address || "");
  const city = address ? address.split(",")[0].trim() : "";
  const company = sanitizeForPrompt(lead.company);
  const contactName = sanitizeForPrompt(lead.name || "the owner");
  const enrichedSummary = enriched?.summary ? sanitizeForPrompt(enriched.summary) : "";
  const enrichedIssues = enriched?.issues ? sanitizeForPrompt(enriched.issues) : "";

  return `Write a natural phone call script for cold-calling a local ${industry.toLowerCase()} business.

LEAD DATA:
Company: ${company}
Industry: ${industry}${city ? `\nCity: ${city}` : ""}${address ? `\nFull address: ${address}` : ""}
Phone: ${lead.phone || "N/A"}
Contact: ${contactName}
${enriched ? `Website: ${enrichedSummary}\nIssues found: ${enrichedIssues}` : "No website or website not analyzed."}

SCRIPT STRUCTURE:
1. OPENING (1 line): "Hi, is this [contact name or company]?" — simple, human, gets them talking.
2. INTRO (1-2 sentences): Who you are (first name only), what you do in plain English, and WHY you're calling them specifically. Reference something specific — their city, their industry, something you noticed about their business. NOT "I help businesses grow online."
3. HOOK (1 sentence): One specific observation about their business that creates curiosity. Example: "I was looking up ${industry.toLowerCase()} in ${city || "your area"} and noticed your business doesn't come up on Google — but your competitor on [nearby street] does." This should be verifiable and specific.
4. ASK (1 sentence): Simple, low-commitment ask. NOT "Can we schedule a call?" — they're already ON a call. Instead: "Would it be cool if I sent you a quick breakdown of what I found? Takes 30 seconds to look at."

RULES:
- Total script under 80 words (people hang up on long pitches)
- Sound like a real person, not reading from a telemarketer script
- Use their company name and city naturally
- NEVER say: "I'm calling from [Agency Name]", "partnership opportunity", "I'd love to help you grow"
- If they have no website, lead with that: "I noticed ${company} doesn't have a website yet — in ${city || "your area"}, about 70% of people search online before picking a ${industry.toLowerCase()}. Just wanted to see if that's something you've been thinking about."
- NEVER use placeholder brackets like [City], [Your Name], etc. Use actual data or skip.
- The "opening" field should ONLY be the first greeting line
- The "script" field should contain the full conversation flow after the opening
${language !== "eng" ? `\nLANGUAGE: Write the ENTIRE script in ${getLanguageName(language)}. The business speaks ${getLanguageName(language)}, so the call must be in their language. Write naturally as a native speaker would.` : ""}

Return ONLY JSON with "opening" and "script" fields.`;
}

// POST /api/generate — Generate AI cold emails for a campaign
router.post("/", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { campaignId, leadIds } = req.body;

    if (!campaignId) {
      res.status(400).json({ error: "Campaign ID is required" });
      return;
    }

    // Check daily generation limit (OpenAI cost protection)
    const genCheck = await checkDailyGenerationLimit(req.userId!);
    if (!genCheck.allowed) {
      res.status(403).json({
        error: `Daily AI generation limit reached (${genCheck.usedToday}/${genCheck.dailyLimit} on ${genCheck.plan} plan). Try again tomorrow.`,
        usedToday: genCheck.usedToday,
        dailyLimit: genCheck.dailyLimit,
        plan: genCheck.plan,
      });
      return;
    }

    // Get user's service type for email personalization
    const basicUserPlan = await getUserPlan(req.userId!);
    const basicServiceType: ServiceType = basicUserPlan.serviceType;
    const features = getFeatureAccess(basicUserPlan.plan, basicUserPlan.isOnTrial);
    const canIncludeAudit = features.auditReports;

    // Fetch leads for the campaign (only email-contactable leads)
    let query = supabase
      .from("leads")
      .select("*")
      .eq("campaign_id", campaignId)
      .eq("user_id", req.userId)
      .neq("contact_method", "call");

    // If specific lead IDs provided, filter to only those
    if (Array.isArray(leadIds) && leadIds.length > 0) {
      query = query.in("id", leadIds);
    }

    const { data: leads, error: leadsError } = await query;

    if (leadsError || !leads || leads.length === 0) {
      res.status(404).json({ error: "No leads found for this campaign" });
      return;
    }

    // Skip leads that already have emails (prevents duplicate generation via Postman)
    const { data: existingEmails } = await supabase
      .from("emails")
      .select("lead_id")
      .eq("campaign_id", campaignId)
      .eq("user_id", req.userId);

    const existingLeadIds = new Set((existingEmails || []).map((e: any) => e.lead_id));
    const newLeads = leads.filter(lead => !existingLeadIds.has(lead.id));

    if (newLeads.length === 0) {
      res.json({ message: "Emails already generated for all leads in this campaign", count: 0, skipped: leads.length });
      return;
    }

    // Atomically RESERVE generation quota before doing paid OpenAI work (race-safe).
    // Basic generate = 1 email (initial) per lead. Grant is clamped to the remaining daily cap.
    const granted = await reserveGenerationsToday(req.userId!, newLeads.length, genCheck.dailyLimit);
    if (granted <= 0) {
      res.status(403).json({
        error: `Daily AI generation limit reached (${genCheck.usedToday}/${genCheck.dailyLimit} on ${genCheck.plan} plan). Try again tomorrow.`,
        usedToday: genCheck.usedToday,
        dailyLimit: genCheck.dailyLimit,
        plan: genCheck.plan,
      });
      return;
    }
    const maxLeads = granted;
    const cappedLeads = newLeads.slice(0, maxLeads);

    const generatedEmails: any[] = [];
    let skippedCount = 0;

    // Filter valid leads first
    const validLeads = cappedLeads.filter(lead => {
      const check = isValidLead(lead);
      if (!check.valid) { skippedCount++; return false; }
      return true;
    });

    // Sender signature block (name/company/address) — fetched once per request
    const senderSignature = await getSenderSignature(req.userId!);

    // Skip leads that already unsubscribed — don't generate emails we'd only cancel.
    const suppressedSet = await getSuppressedEmails(req.userId!, validLeads.map(l => l.email));
    const sendableLeads = validLeads.filter(l => !suppressedSet.has((l.email || "").toLowerCase()));

    // Generate emails in parallel batches of 5
    const results = await processBatch(sendableLeads, PARALLEL_BATCH_SIZE, async (lead) => {
      const tone = pickTone();
      const unsubUrl = buildUnsubscribeUrl(req.userId!, lead.email);
      const hasNoWebsite = !lead.website || !lead.website.startsWith("http");
      const enrichedData = lead.enriched_data || {};
      const hasBrokenWebsite = !hasNoWebsite && (enrichedData._siteDown === true || (!enrichedData.title && !enrichedData.description && (!enrichedData.technologies || enrichedData.technologies.length === 0)));
      const auditUrl = canIncludeAudit ? await ensureAuditToken(lead, basicServiceType) : undefined;
      const summary = enrichedData.summary || lead.company;
      const leadLanguage = lead.detected_language || "eng";
      const prompt = buildInitialPrompt(lead, tone, hasNoWebsite ? { noWebsite: true, auditUrl } : hasBrokenWebsite ? { brokenWebsite: true, auditUrl } : { summary, auditUrl }, basicServiceType, leadLanguage);

      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.85,
          response_format: { type: "json_object" },
        });

        const content = completion.choices[0].message.content;
        if (content) {
          const emailData = JSON.parse(content);
          if (emailData.subject && emailData.body) {
            return {
              lead_id: lead.id,
              campaign_id: campaignId,
              user_id: req.userId,
              to_email: lead.email,
              subject: emailData.subject,
              body: appendOptOut(appendSignature(emailData.body, senderSignature), unsubUrl),
              status: "pending",
              sequence_step: 1,
              tone_variant: tone,
            };
          }
        }
      } catch (err) {
        logger.error({ leadId: lead.id, error: err instanceof Error ? err.message : err }, "Generate error for lead");
      }
      return null;
    });

    generatedEmails.push(...results);

    if (generatedEmails.length === 0) {
      // Nothing generated — give back the full reservation.
      await releaseGenerationsToday(req.userId!, granted);
      res.status(500).json({ error: "Failed to generate any emails" });
      return;
    }

    // Store generated emails in DB
    const { error: insertError } = await supabase
      .from("emails")
      .insert(generatedEmails);

    if (insertError) {
      // Not saved — give back the full reservation.
      await releaseGenerationsToday(req.userId!, granted);
      res.status(500).json({ error: "Failed to save generated emails" });
      return;
    }

    // Reconcile: the reservation already counted `granted`; give back any unused slots
    // (leads that were invalid, suppressed, or failed generation).
    await releaseGenerationsToday(req.userId!, granted - generatedEmails.length);

    await supabase
      .from("campaigns")
      .update({ status: "draft" })
      .eq("id", campaignId)
      .eq("user_id", req.userId);

    res.json({
      message: "Emails generated successfully",
      count: generatedEmails.length,
      skipped: skippedCount,
      capped: leads.length > maxLeads ? leads.length - maxLeads : 0,
    });
  } catch {
    res.status(500).json({ error: "Failed to generate emails" });
  }
});

// POST /api/generate/advanced — Generate highly personalized emails using enriched lead data
router.post("/advanced", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { campaignId, enableFollowups = false, leadIds } = req.body;

    if (!campaignId) {
      res.status(400).json({ error: "Campaign ID is required" });
      return;
    }

    // Check daily generation limit (OpenAI cost protection)
    const genCheck = await checkDailyGenerationLimit(req.userId!);
    if (!genCheck.allowed) {
      res.status(403).json({
        error: `Daily AI generation limit reached (${genCheck.usedToday}/${genCheck.dailyLimit} on ${genCheck.plan} plan). Try again tomorrow.`,
        usedToday: genCheck.usedToday,
        dailyLimit: genCheck.dailyLimit,
        plan: genCheck.plan,
      });
      return;
    }

    // Each lead = 1 generation (initial only) or 3 (initial + 2 follow-ups).
    // Quota is atomically reserved after we know how many new leads there are (see below).
    const generationsPerLead = enableFollowups ? 3 : 1;

    // Get user's service type to tailor email generation
    const userPlan = await getUserPlan(req.userId!);
    const userServiceType: ServiceType = userPlan.serviceType;
    const userFeatures = getFeatureAccess(userPlan.plan, userPlan.isOnTrial);
    const userCanIncludeAudit = userFeatures.auditReports;

    // Fetch campaign
    const { data: campaign, error: campaignError } = await supabase
      .from("campaigns")
      .select("*")
      .eq("id", campaignId)
      .eq("user_id", req.userId)
      .single();

    if (campaignError || !campaign) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }

    // Fetch leads with enriched data (high-quality leads with score >= 40, email only)
    let query = supabase
      .from("leads")
      .select("*")
      .eq("campaign_id", campaignId)
      .eq("user_id", req.userId)
      .neq("contact_method", "call")
      .order("score", { ascending: false });

    // If specific lead IDs provided, filter to only those
    if (Array.isArray(leadIds) && leadIds.length > 0) {
      query = query.in("id", leadIds);
    }

    const { data: leads, error: leadsError } = await query;

    if (leadsError || !leads || leads.length === 0) {
      res.status(404).json({
        error: "No high-quality (scored) leads found. Please enrich leads first.",
      });
      return;
    }

    // Skip leads that already have emails (prevents duplicate generation via Postman)
    const { data: existingEmails } = await supabase
      .from("emails")
      .select("lead_id")
      .eq("campaign_id", campaignId)
      .eq("user_id", req.userId);

    const existingLeadIds = new Set((existingEmails || []).map((e: any) => e.lead_id));
    const newLeads = leads.filter(lead => !existingLeadIds.has(lead.id));

    if (newLeads.length === 0) {
      res.json({ message: "Emails already generated for all leads in this campaign", count: 0, skipped: leads.length });
      return;
    }

    // Atomically RESERVE generation quota before paid OpenAI work (race-safe).
    // Each lead needs `generationsPerLead` emails; grant is clamped to the remaining daily cap.
    const granted = await reserveGenerationsToday(req.userId!, newLeads.length * generationsPerLead, genCheck.dailyLimit);
    if (granted < generationsPerLead) {
      res.status(403).json({
        error: `Daily AI generation limit reached (${genCheck.usedToday}/${genCheck.dailyLimit} on ${genCheck.plan} plan). Need ${generationsPerLead} per lead. Try again tomorrow.`,
        usedToday: genCheck.usedToday,
        dailyLimit: genCheck.dailyLimit,
        plan: genCheck.plan,
      });
      return;
    }
    const maxLeads = Math.floor(granted / generationsPerLead);

    // Cap leads to reserved daily generation slots
    const cappedLeads = newLeads.slice(0, maxLeads);

    const generatedEmails: any[] = [];
    let skippedCount = 0;

    // Filter valid leads first
    const validLeads = cappedLeads.filter(lead => {
      const check = isValidLead(lead);
      if (!check.valid) { skippedCount++; return false; }
      return true;
    });

    // Sender signature block (name/company/address) — fetched once per request
    const senderSignature = await getSenderSignature(req.userId!);

    // Skip leads that already unsubscribed — don't generate emails we'd only cancel.
    const suppressedSet = await getSuppressedEmails(req.userId!, validLeads.map(l => l.email));
    const sendableLeads = validLeads.filter(l => !suppressedSet.has((l.email || "").toLowerCase()));

    // Generate emails in parallel batches of 5
    const results = await processBatch(sendableLeads, PARALLEL_BATCH_SIZE, async (lead) => {
      const enrichedData = lead.enriched_data || {};
      const unsubUrl = buildUnsubscribeUrl(req.userId!, lead.email);
      const summary = enrichedData.summary || lead.company;
      const issues = (enrichedData.issues || []).slice(0, 2).join(", ");
      const tone = pickTone();
      const emails: any[] = [];

      // Build specific digital gaps list from enrichment data, prioritized by industry relevance
      const industry = (enrichedData.industry || lead.industry || "").toLowerCase();
      const isSPA = enrichedData.isSPA || false;
      const allGaps: { gap: string; priority: number }[] = [];

      // --- CRITICAL "go check it yourself" gaps (highest conversion) ---

      // No SSL — browser literally warns visitors
      if (enrichedData.hasSSL === false) {
        allGaps.push({ gap: "No SSL certificate — Chrome shows 'Not Secure' warning to every visitor (open the site in Chrome and see for yourself)", priority: 110 });
      }

      // Not mobile-friendly — broken on phones
      if (!isSPA && enrichedData.isMobileFriendly === false) {
        allGaps.push({ gap: "Website is not mobile-friendly — try opening it on your phone, the layout breaks and text is unreadable", priority: 105 });
      }

      // Slow page load (>3s)
      if (enrichedData.pageLoadTimeMs && enrichedData.pageLoadTimeMs > 3000) {
        const secs = (enrichedData.pageLoadTimeMs / 1000).toFixed(1);
        allGaps.push({ gap: `Website takes ${secs} seconds to load — over half of visitors leave a site that takes more than 3 seconds`, priority: 95 });
      }

      // Parked domain
      if (enrichedData.isParkedDomain) {
        allGaps.push({ gap: "Domain is parked or 'under construction' — effectively no website exists for customers", priority: 115 });
      }

      // --- FUNCTIONAL gaps ---

      // Booking — highest for service businesses
      if (!isSPA && enrichedData.hasOnlineBooking === false) {
        const bookingIndustries = ["dental", "medical", "salon", "fitness", "restaurant", "plumbing", "hvac", "automotive", "spa", "clinic", "vet", "chiropract"];
        const isBookingCritical = bookingIndustries.some(i => industry.includes(i));
        allGaps.push({ gap: "No online booking system — customers can't schedule appointments from the website, they have to call", priority: isBookingCritical ? 100 : 70 });
      }

      // Contact form
      if (!isSPA && enrichedData.hasContactForm === false) {
        const contactIndustries = ["legal", "real estate", "medical", "dental", "consulting", "accounting"];
        const isContactCritical = contactIndustries.some(i => industry.includes(i));
        allGaps.push({ gap: "No contact form — potential customers have no easy way to reach out except calling", priority: isContactCritical ? 95 : 65 });
      }

      // No social media
      if (!enrichedData.socialLinks || enrichedData.socialLinks.length === 0) {
        allGaps.push({ gap: "Zero social media presence — invisible to customers who search on Instagram, Facebook, or Google Maps", priority: 60 });
      } else if (enrichedData.socialLinks.length <= 1) {
        allGaps.push({ gap: "Weak social media (only on 1 platform) — missing customers on the platforms they actually use", priority: 40 });
      }

      // --- SEO / credibility gaps ---

      // No meta description
      if (enrichedData.hasMetaDescription === false) {
        allGaps.push({ gap: "Missing meta description — when someone Googles the business, the search result shows a blank or auto-generated snippet", priority: 55 });
      }

      // Outdated copyright
      const currentYear = new Date().getFullYear();
      if (enrichedData.copyrightYear && enrichedData.copyrightYear < currentYear - 1) {
        allGaps.push({ gap: `Copyright in the footer says © ${enrichedData.copyrightYear} — makes the business look inactive or closed`, priority: 50 });
      }

      // Outdated tech
      if (enrichedData.technologies?.includes("WordPress")) {
        allGaps.push({ gap: "Running on WordPress — can be slow, vulnerable to hacks, and expensive to maintain", priority: 50 });
      }
      if (enrichedData.technologies?.some((t: string) => ["Joomla", "Drupal"].includes(t))) {
        allGaps.push({ gap: `Built on ${enrichedData.technologies.find((t: string) => ["Joomla", "Drupal"].includes(t))} — severely outdated platform that's hard and costly to update`, priority: 55 });
      }

      // No platform detected
      if (!enrichedData.technologies || enrichedData.technologies.length === 0) {
        allGaps.push({ gap: "Basic/outdated website with no modern platform — likely looks unprofessional on mobile", priority: 45 });
      }

      // --- MARKETING / ADS gaps (higher priority for digital_marketing service type) ---
      const isMarketingUser = userServiceType === "digital_marketing" || userServiceType === "social_media";
      const isSocialUser = userServiceType === "social_media";

      // No Google Ads
      if (enrichedData.hasGoogleAds === false) {
        allGaps.push({ gap: "Not running Google Ads — competitors are paying to appear at the top while they're invisible in search", priority: isMarketingUser ? 100 : 35 });
      }

      // No Facebook Pixel
      if (enrichedData.hasFacebookPixel === false) {
        allGaps.push({ gap: "No Facebook/Meta Pixel — can't retarget website visitors or run effective social ads", priority: isMarketingUser || isSocialUser ? 90 : 30 });
      }

      // No analytics
      if (enrichedData.hasAnalytics === false) {
        allGaps.push({ gap: "No Google Analytics — completely blind to how many people visit the site and what they do", priority: isMarketingUser ? 85 : 30 });
      }

      // No lead capture / email signup form
      if (enrichedData.hasLeadCaptureForm === false) {
        allGaps.push({ gap: "No email signup or lead capture — visitors leave and never come back, zero way to nurture them", priority: isMarketingUser ? 88 : 25 });
      }

      // No email marketing platform
      if (enrichedData.hasEmailMarketing === false) {
        allGaps.push({ gap: "No email marketing setup — not collecting or nurturing leads through automated follow-ups", priority: isMarketingUser ? 70 : 15 });
      }

      // No Open Graph tags (social sharing looks broken)
      if (enrichedData.hasOpenGraph === false) {
        allGaps.push({ gap: "No Open Graph tags — when shared on social media, the link shows no image or description (looks broken)", priority: isMarketingUser || isSocialUser ? 65 : 15 });
      }

      // No retargeting pixels (beyond Facebook)
      if (enrichedData.hasRetargeting === false && enrichedData.hasFacebookPixel === false) {
        allGaps.push({ gap: "Zero retargeting setup — 97% of visitors leave without converting and never see another ad from this business", priority: isMarketingUser ? 75 : 20 });
      }

      // No schema markup
      if (enrichedData.hasSchemaMarkup === false) {
        allGaps.push({ gap: "No structured data markup — missing rich snippets in Google (stars, hours, FAQ) that boost click-through rates", priority: isMarketingUser ? 50 : 20 });
      }

      // No clear CTA above the fold
      if (enrichedData.hasCTA === false) {
        allGaps.push({ gap: "No clear call-to-action above the fold — visitors don't know what action to take", priority: isMarketingUser ? 60 : 30 });
      }

      // Low Google rating / few reviews
      if (enrichedData.googleRating !== undefined && enrichedData.googleRating < 4.0) {
        allGaps.push({ gap: `Google rating is ${enrichedData.googleRating}/5 — below the trust threshold where customers start looking at competitors instead`, priority: isMarketingUser || isSocialUser ? 80 : 35 });
      }
      if (enrichedData.googleReviewCount !== undefined && enrichedData.googleReviewCount < 10) {
        allGaps.push({ gap: `Only ${enrichedData.googleReviewCount} Google reviews — competitors with 50+ reviews look far more trustworthy to new customers`, priority: isSocialUser ? 85 : isMarketingUser ? 75 : 30 });
      }

      // Detect no-website and broken-website leads
      const hasNoWebsite = !lead.website || !lead.website.startsWith("http");
      const hasBrokenWebsite = !hasNoWebsite && !enrichedData.title && !enrichedData.description && (!enrichedData.technologies || enrichedData.technologies.length === 0) && !enrichedData.hasOnlineBooking && !enrichedData.hasContactForm && (!enrichedData.socialLinks || enrichedData.socialLinks.length === 0);

      // Sort by priority (highest first) and take top 3
      allGaps.sort((a, b) => b.priority - a.priority);
      const topGaps = allGaps.slice(0, 3);
      const gaps = topGaps.map(g => `- ${g.gap}`);
      const digitalGaps = gaps.length > 0 ? gaps.join("\n") : "";

      // Initial email — auto-generate audit token if enrichment exists
      const auditUrl = userCanIncludeAudit ? await ensureAuditToken(lead, userServiceType) : undefined;
      const leadLanguage = lead.detected_language || "eng";
      const initialPrompt = buildInitialPrompt(lead, tone, { summary, issues, digitalGaps, noWebsite: hasNoWebsite, brokenWebsite: hasBrokenWebsite, auditUrl }, userServiceType, leadLanguage);
      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [{ role: "user", content: initialPrompt }],
          temperature: 0.85,
          response_format: { type: "json_object" },
        });

        const content = completion.choices[0].message.content;
        if (content) {
          const emailData = JSON.parse(content);
          if (emailData.subject && emailData.body) {
            emails.push({
              lead_id: lead.id,
              campaign_id: campaignId,
              user_id: req.userId,
              to_email: lead.email,
              subject: emailData.subject,
              body: appendOptOut(appendSignature(emailData.body, senderSignature), unsubUrl),
              status: "pending",
              sequence_step: 1,
              scheduled_at: null,
              tone_variant: tone,
            });

            // Generate follow-ups in parallel if enabled
            if (enableFollowups) {
              const [f1Result, f2Result] = await Promise.all([
                // Follow-up 1
                (async () => {
                  try {
                    const topGap = gaps.length > 0 ? gaps[0].replace("- ", "") : undefined;
                    const f1Prompt = buildFollowup1Prompt(sanitizeForPrompt(lead.company), sanitizeForPrompt(issues), tone, topGap ? sanitizeForPrompt(topGap) : undefined, leadLanguage);
                    const f1 = await openai.chat.completions.create({
                      model: "gpt-4o",
                      messages: [{ role: "user", content: f1Prompt }],
                      temperature: 0.8,
                      response_format: { type: "json_object" },
                    });
                    const f1Content = f1.choices[0].message.content;
                    if (f1Content) {
                      const f1Data = JSON.parse(f1Content);
                      if (f1Data.subject && f1Data.body) {
                        return {
                          lead_id: lead.id,
                          campaign_id: campaignId,
                          user_id: req.userId,
                          to_email: lead.email,
                          subject: f1Data.subject,
                          body: appendOptOut(appendSignature(f1Data.body, senderSignature), unsubUrl),
                          status: "pending",
                          sequence_step: 2,
                          scheduled_at: calculateFollowUpDate(2, 4),
                          tone_variant: tone,
                        };
                      }
                    }
                  } catch { logger.error({ leadId: lead.id }, "Failed follow-up 1"); }
                  return null;
                })(),
                // Follow-up 2
                (async () => {
                  try {
                    const f2Prompt = buildFollowup2Prompt(sanitizeForPrompt(lead.company), tone, leadLanguage);
                    const f2 = await openai.chat.completions.create({
                      model: "gpt-4o",
                      messages: [{ role: "user", content: f2Prompt }],
                      temperature: 0.7,
                      response_format: { type: "json_object" },
                    });
                    const f2Content = f2.choices[0].message.content;
                    if (f2Content) {
                      const f2Data = JSON.parse(f2Content);
                      if (f2Data.subject && f2Data.body) {
                        return {
                          lead_id: lead.id,
                          campaign_id: campaignId,
                          user_id: req.userId,
                          to_email: lead.email,
                          subject: f2Data.subject,
                          body: appendOptOut(appendSignature(f2Data.body, senderSignature), unsubUrl),
                          status: "pending",
                          sequence_step: 3,
                          scheduled_at: calculateFollowUpDate(5, 7),
                          tone_variant: tone,
                        };
                      }
                    }
                  } catch { logger.error({ leadId: lead.id }, "Failed follow-up 2"); }
                  return null;
                })(),
              ]);

              if (f1Result) emails.push(f1Result);
              if (f2Result) emails.push(f2Result);
            }
          }
        }
      } catch (err) {
        logger.error({ leadId: lead.id, error: err instanceof Error ? err.message : err }, "Generate error for lead");
      }
      return emails.length > 0 ? emails : null;
    });

    // Flatten results (each result is an array of emails for one lead)
    for (const leadEmails of results) {
      generatedEmails.push(...leadEmails);
    }

    if (generatedEmails.length === 0) {
      await releaseGenerationsToday(req.userId!, granted);
      res.status(500).json({ error: "Failed to generate emails" });
      return;
    }

    const { error: insertError } = await supabase
      .from("emails")
      .insert(generatedEmails);

    if (insertError) {
      await releaseGenerationsToday(req.userId!, granted);
      res.status(500).json({ error: "Failed to save generated emails" });
      return;
    }

    // Reconcile: reservation already counted `granted`; give back any unused slots
    // (leads that were invalid, suppressed, or failed generation).
    await releaseGenerationsToday(req.userId!, granted - generatedEmails.length);

    if (enableFollowups) {
      await supabase
        .from("campaigns")
        .update({ enable_followups: true })
        .eq("id", campaignId)
        .eq("user_id", req.userId);
    }

    res.json({
      message: "Advanced emails generated successfully",
      count: generatedEmails.length,
      initialEmails: cappedLeads.length,
      skipped: skippedCount,
      followUpsIncluded: enableFollowups,
      capped: leads.length > maxLeads ? leads.length - maxLeads : 0,
    });
  } catch (error) {
    logger.error({ error }, "Advanced generate error");
    res.status(500).json({ error: "Failed to generate emails" });
  }
});

// POST /api/generate/call-scripts — Generate call scripts for call-only leads
router.post("/call-scripts", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { campaignId, leadIds } = req.body;

    if (!campaignId) {
      res.status(400).json({ error: "Campaign ID is required" });
      return;
    }

    // Check daily generation limit (OpenAI cost protection)
    const genCheck = await checkDailyGenerationLimit(req.userId!);
    if (!genCheck.allowed) {
      res.status(403).json({
        error: `Daily AI generation limit reached (${genCheck.usedToday}/${genCheck.dailyLimit} on ${genCheck.plan} plan). Try again tomorrow.`,
        usedToday: genCheck.usedToday,
        dailyLimit: genCheck.dailyLimit,
        plan: genCheck.plan,
      });
      return;
    }

    // Fetch call-only leads
    let callQuery = supabase
      .from("leads")
      .select("*")
      .eq("campaign_id", campaignId)
      .eq("user_id", req.userId)
      .eq("contact_method", "call");

    // If specific lead IDs provided, filter to only those
    if (Array.isArray(leadIds) && leadIds.length > 0) {
      callQuery = callQuery.in("id", leadIds);
    }

    const { data: leads, error: leadsError } = await callQuery;

    if (leadsError || !leads || leads.length === 0) {
      res.status(404).json({ error: "No call leads found for this campaign" });
      return;
    }

    const validLeads = leads.filter(l => l.company && l.company.trim().length >= 2);

    // Cap to remaining daily generation slots
    const cappedLeads = validLeads.slice(0, genCheck.remaining);

    // Generate call scripts in parallel batches of 5
    const scripts = await processBatch(cappedLeads, PARALLEL_BATCH_SIZE, async (lead) => {
      const enrichedData = lead.enriched_data || {};
      const leadLanguage = lead.detected_language || "eng";
      const prompt = buildCallScriptPrompt(lead, {
        summary: enrichedData.summary,
        issues: (enrichedData.issues || []).join(", "),
      }, leadLanguage);

      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.8,
          response_format: { type: "json_object" },
        });

        const content = completion.choices[0].message.content;
        if (content) {
          const scriptData = JSON.parse(content);

          // Save call script to lead's enriched_data
          await supabase
            .from("leads")
            .update({
              enriched_data: {
                ...enrichedData,
                call_script: scriptData,
              },
            })
            .eq("id", lead.id)
            .eq("user_id", req.userId);

          return {
            lead_id: lead.id,
            company: lead.company,
            phone: lead.phone,
            opening: scriptData.opening || "",
            script: scriptData.script || "",
          };
        }
      } catch (err) {
        logger.error({ leadId: lead.id, error: err instanceof Error ? err.message : err }, "CallScript error for lead");
      }
      return null;
    });

    res.json({
      message: "Call scripts generated",
      count: scripts.length,
      scripts,
    });
  } catch {
    res.status(500).json({ error: "Failed to generate call scripts" });
  }
});

export default router;
