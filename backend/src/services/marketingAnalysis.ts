import * as cheerio from "cheerio";
import { URL } from "url";
import { safeGet, isSameSite } from "./httpClient";
import type { CrawledPage } from "./seoAnalysis";

// =============================================
// Digital marketing analysis
// =============================================
// Deepens the existing boolean marketing signals (hasAnalytics, hasFacebookPixel, …)
// into an inventory + quality assessment: which tools are installed, how much friction
// the lead form creates, how strong the calls-to-action are, and whether a visitor has
// an unbroken path from landing page to enquiry.
//
// All of it is derived from HTML the scraper already downloads, plus at most one extra
// fetch to follow the primary CTA. No external API.

// ---------------------------------------------------------------------------
// 1. Marketing technology inventory
// ---------------------------------------------------------------------------

export type TechCategory = "analytics" | "advertising" | "retargeting" | "automation" | "chat" | "cro";

interface TechSignature {
  name: string;
  category: TechCategory;
  /** Substrings matched against the combined lowercased HTML of all crawled pages. */
  patterns: string[];
  /** Optional stricter regex checks (for inline snippets like `fbq('init'`). */
  regexes?: RegExp[];
}

const TECH_SIGNATURES: TechSignature[] = [
  // ---- Analytics & measurement ----
  { name: "Google Analytics", category: "analytics", patterns: ["google-analytics.com", "googletagmanager.com/gtag/js"], regexes: [/['"]G-[A-Z0-9]{6,}['"]/i, /['"]UA-\d+-\d+['"]/i] },
  { name: "Google Tag Manager", category: "analytics", patterns: ["googletagmanager.com/gtm.js", "googletagmanager.com/ns.html"], regexes: [/GTM-[A-Z0-9]{4,}/i] },
  { name: "Microsoft Clarity", category: "analytics", patterns: ["clarity.ms"], regexes: [/clarity\s*\(\s*['"]/i] },
  { name: "Hotjar", category: "analytics", patterns: ["static.hotjar.com", "hotjar.com/c/hotjar"], regexes: [/\bhjid\b/i, /\b_hjSettings\b/] },
  { name: "Matomo", category: "analytics", patterns: ["matomo.js", "piwik.js", "matomo.cloud"] },
  { name: "Plausible", category: "analytics", patterns: ["plausible.io/js"] },
  { name: "Fathom Analytics", category: "analytics", patterns: ["cdn.usefathom.com"] },
  { name: "Mixpanel", category: "analytics", patterns: ["cdn.mxpnl.com", "api.mixpanel.com"] },
  { name: "Segment", category: "analytics", patterns: ["cdn.segment.com/analytics.js"] },

  // ---- Advertising / conversion tracking ----
  { name: "Google Ads", category: "advertising", patterns: ["googleads.g.doubleclick.net", "google_conversion_id", "googleadservices.com"], regexes: [/AW-\d{6,}/, /gtag\s*\(\s*['"]config['"]\s*,\s*['"]AW-/i] },
  { name: "Meta Pixel", category: "advertising", patterns: ["connect.facebook.net", "facebook.com/tr?", "facebook.com/tr/?"], regexes: [/fbq\s*\(\s*['"]init['"]/i] },
  { name: "Microsoft Ads UET", category: "advertising", patterns: ["bat.bing.com"], regexes: [/\buetq\b/i] },

  // ---- Retargeting ----
  { name: "TikTok Pixel", category: "retargeting", patterns: ["analytics.tiktok.com"], regexes: [/ttq\.load/i] },
  { name: "LinkedIn Insight Tag", category: "retargeting", patterns: ["snap.licdn.com", "linkedin.com/insight"], regexes: [/_linkedin_partner_id/i] },
  { name: "X (Twitter) Pixel", category: "retargeting", patterns: ["static.ads-twitter.com"], regexes: [/twq\s*\(/i] },
  { name: "Pinterest Tag", category: "retargeting", patterns: ["s.pinimg.com/ct"], regexes: [/pintrk\s*\(/i] },
  { name: "Snapchat Pixel", category: "retargeting", patterns: ["sc-static.net/scevent"], regexes: [/snaptr\s*\(/i] },
  { name: "Criteo", category: "retargeting", patterns: ["static.criteo.net"] },
  { name: "AdRoll", category: "retargeting", patterns: ["adroll.com", "d.adroll.com"] },

  // ---- Marketing automation / email ----
  { name: "HubSpot", category: "automation", patterns: ["hs-scripts.com", "hsforms.com", "hsforms.net", "hubspot.com/forms", "js.hs-analytics.net", "hs-banner.com"] },
  { name: "Marketo", category: "automation", patterns: ["marketo.net", "munchkin.marketo", "mktoresp.com"] },
  { name: "Pardot", category: "automation", patterns: ["pardot.com", "pi.pardot.com"] },
  { name: "ActiveCampaign", category: "automation", patterns: ["activecampaign.com", "activehosted.com"] },
  { name: "Klaviyo", category: "automation", patterns: ["klaviyo.com", "static.klaviyo.com"] },
  { name: "Mailchimp", category: "automation", patterns: ["mailchimp.com", "list-manage.com", "chimpstatic.com"] },
  { name: "ConvertKit", category: "automation", patterns: ["convertkit.com", "ck.page", "convertkit-mail"] },
  { name: "Brevo", category: "automation", patterns: ["brevo.com", "sendinblue.com", "sibautomation.com"] },
  { name: "Omnisend", category: "automation", patterns: ["omnisend.com", "omnisnippet"] },
  { name: "MailerLite", category: "automation", patterns: ["mailerlite.com"] },
  { name: "GetResponse", category: "automation", patterns: ["getresponse.com"] },
  { name: "AWeber", category: "automation", patterns: ["aweber.com"] },
  { name: "Constant Contact", category: "automation", patterns: ["constantcontact.com"] },
  { name: "Drip", category: "automation", patterns: ["getdrip.com", "drip.com"] },
  { name: "Flodesk", category: "automation", patterns: ["flodesk.com"] },

  // ---- Live chat / conversational ----
  { name: "Intercom", category: "chat", patterns: ["intercom.io", "intercomcdn.com"] },
  { name: "Drift", category: "chat", patterns: ["drift.com", "driftt.com"] },
  { name: "Tawk.to", category: "chat", patterns: ["tawk.to"] },
  { name: "Crisp", category: "chat", patterns: ["crisp.chat"] },
  { name: "Tidio", category: "chat", patterns: ["tidio.co", "tidiochat"] },
  { name: "LiveChat", category: "chat", patterns: ["livechatinc.com"] },
  { name: "Zendesk Chat", category: "chat", patterns: ["zendesk.com/embeddable", "zopim.com"] },
  { name: "Freshchat", category: "chat", patterns: ["freshchat.com", "wchat.freshchat"] },
  { name: "Smartsupp", category: "chat", patterns: ["smartsupp.com"] },

  // ---- Conversion-rate optimisation ----
  { name: "OptinMonster", category: "cro", patterns: ["optinmonster.com", "omappapi.com"] },
  { name: "Privy", category: "cro", patterns: ["privy.com", "privymktg.com"] },
  { name: "Sleeknote", category: "cro", patterns: ["sleeknote.com", "sleeknotecustomerscripts"] },
  { name: "Sumo", category: "cro", patterns: ["sumo.com", "sumome.com"] },
  { name: "Leadpages", category: "cro", patterns: ["leadpages.com", "lpcontent.net"] },
  { name: "Unbounce", category: "cro", patterns: ["unbounce.com", "ubembed.com"] },
  { name: "VWO", category: "cro", patterns: ["visualwebsiteoptimizer.com"] },
  { name: "Optimizely", category: "cro", patterns: ["optimizely.com"] },
];

export interface MarketingTechResult {
  marketingTechnologies: string[];
  techByCategory: Record<TechCategory, string[]>;
  hasClarity: boolean;
  hasHotjar: boolean;
  hasMicrosoftUET: boolean;
  hasHubSpot: boolean;
  hasTagManager: boolean;
  hasLiveChat: boolean;
  hasHeatmapTool: boolean;
}

/**
 * Match every known signature against the combined page HTML.
 *
 * Detection is one-directional evidence: finding a script proves the tool is installed,
 * but not finding one only proves it wasn't in the HTML we fetched. The audit copy is
 * worded as "not detected" for exactly this reason.
 */
export function detectMarketingTech(allHtml: string): MarketingTechResult {
  const html = allHtml.toLowerCase();
  const found: string[] = [];
  const byCategory: Record<TechCategory, string[]> = {
    analytics: [], advertising: [], retargeting: [], automation: [], chat: [], cro: [],
  };

  for (const sig of TECH_SIGNATURES) {
    const hit =
      sig.patterns.some((p) => html.includes(p)) ||
      (sig.regexes || []).some((re) => re.test(allHtml));
    if (hit) {
      found.push(sig.name);
      byCategory[sig.category].push(sig.name);
    }
  }

  return {
    marketingTechnologies: found,
    techByCategory: byCategory,
    hasClarity: found.includes("Microsoft Clarity"),
    hasHotjar: found.includes("Hotjar"),
    hasMicrosoftUET: found.includes("Microsoft Ads UET"),
    hasHubSpot: found.includes("HubSpot"),
    hasTagManager: found.includes("Google Tag Manager"),
    hasLiveChat: byCategory.chat.length > 0,
    hasHeatmapTool: found.includes("Hotjar") || found.includes("Microsoft Clarity"),
  };
}

// ---------------------------------------------------------------------------
// 2. Lead form friction
// ---------------------------------------------------------------------------

export interface FormFrictionResult {
  formFieldCount: number;
  requiredFieldCount: number;
  formFriction: "low" | "medium" | "high" | null;
  formHasPhoneRequired: boolean;
}

// Inputs that don't ask the visitor for anything shouldn't count toward friction.
const NON_INPUT_TYPES = new Set(["hidden", "submit", "button", "image", "reset"]);

/**
 * Score the friction of the site's primary lead form.
 *
 * "Primary" = the form that most looks like an enquiry form (has a message box or a
 * contact-shaped field set), preferring the one with the most visible fields. Search
 * boxes and single-field newsletter signups are excluded — counting those as the lead
 * form would understate friction and produce a nonsense finding.
 */
export function analyzeFormFriction(pages: CrawledPage[]): FormFrictionResult {
  let best: { fields: number; required: number; phoneRequired: boolean } | null = null;

  for (const page of pages) {
    page.$("form").each((_i: number, form: any) => {
      const $form = page.$(form);
      const formHtml = ($form.html() || "").toLowerCase();

      // Skip site search forms.
      const action = ($form.attr("action") || "").toLowerCase();
      const role = ($form.attr("role") || "").toLowerCase();
      if (role === "search" || /\/?search/.test(action)) return;
      if ($form.find('input[type="search"], input[name="s"], input[name="q"]').length > 0 && $form.find("textarea").length === 0) return;

      let fields = 0;
      let required = 0;
      let phoneRequired = false;

      $form.find("input, select, textarea").each((_j: number, el: any) => {
        const $el = page.$(el);
        const tag = (el.tagName || el.name || "").toLowerCase();
        const type = ($el.attr("type") || (tag === "input" ? "text" : tag)).toLowerCase();
        if (tag === "input" && NON_INPUT_TYPES.has(type)) return;
        // Consent checkboxes are a legal requirement, not friction the business chose.
        const nameAttr = ($el.attr("name") || "").toLowerCase();
        if (type === "checkbox" && /consent|gdpr|privacy|terms|agree|newsletter|opt-?in/.test(nameAttr)) return;

        fields++;
        const isRequired = $el.attr("required") !== undefined || ($el.attr("aria-required") || "") === "true";
        if (isRequired) {
          required++;
          if (type === "tel" || /phone|tel|mobile/.test(nameAttr)) phoneRequired = true;
        }
      });

      if (fields === 0) return;

      // Only treat it as the lead form if it looks like an enquiry, not a signup.
      const looksLikeEnquiry =
        formHtml.includes("<textarea") ||
        (fields >= 3 && /type="email"|name="email"|type="tel"|name="phone"/.test(formHtml));
      if (!looksLikeEnquiry) return;

      if (!best || fields > best.fields) best = { fields, required, phoneRequired };
    });
  }

  if (!best) {
    return { formFieldCount: 0, requiredFieldCount: 0, formFriction: null, formHasPhoneRequired: false };
  }

  // Friction is driven by what the visitor MUST fill in; total fields only matter when
  // nothing is explicitly marked required (many forms validate in JavaScript instead).
  const chosen = best as { fields: number; required: number; phoneRequired: boolean };
  const effective = chosen.required > 0 ? chosen.required : chosen.fields;
  const friction: "low" | "medium" | "high" = effective <= 3 ? "low" : effective <= 6 ? "medium" : "high";

  return {
    formFieldCount: chosen.fields,
    requiredFieldCount: chosen.required,
    formFriction: friction,
    formHasPhoneRequired: chosen.phoneRequired,
  };
}

// ---------------------------------------------------------------------------
// 3. Call-to-action quality
// ---------------------------------------------------------------------------

export interface CtaResult {
  ctaTexts: string[];
  primaryCTA: string | null;
  primaryCTAHref: string | null;
  ctaStrength: "strong" | "medium" | "weak" | null;
  ctaAboveFold: boolean;
  ctaCount: number;
  /**
   * Two or more DIFFERENT high-intent actions competing for attention in the opening
   * screen (e.g. "Book now" next to "Get a quote" next to "Call us"). Repeating the
   * SAME action is good practice; offering several different ones asks the visitor to
   * make a decision before they've decided anything.
   */
  competingCtas: boolean;
  competingCtaTexts: string[];
}

// Phrases that ask for a commitment — these convert. Ordered roughly by intent.
const HIGH_INTENT_CTA = [
  "book appointment", "book now", "book a call", "book online", "make an appointment",
  "schedule a consultation", "schedule an appointment", "schedule now", "schedule a call",
  "get a quote", "get quote", "free quote", "request a quote", "request quote",
  "request an estimate", "free estimate", "get estimate",
  "free consultation", "book a consultation", "request a callback", "request callback",
  "start free trial", "start your free trial", "try free", "get started",
  "contact us", "get in touch", "call now", "call us", "enquire now", "inquire now",
  "buy now", "order now", "shop now", "sign up", "reserve",
];

// Phrases that don't ask for anything — present but not converting.
const LOW_INTENT_CTA = [
  "learn more", "read more", "see more", "find out more", "discover", "explore",
  "view more", "our services", "about us", "more info", "details", "see all",
];

// Buttons that exist for consent, navigation or account access are not calls-to-action
// in any marketing sense. Without this filter a cookie banner reliably wins the
// "primary CTA" slot — it is a <button>, it sits at the top of the DOM, and it is on
// virtually every site — which would put "Accept all cookies" in the report as the
// business's main conversion action.
const NON_CTA_TEXT = [
  "cookie", "cookies", "consent", "accept all", "accept additional", "reject all",
  "manage preferences", "privacy settings", "privacy policy", "terms", "gdpr",
  "skip to", "close", "dismiss", "menu", "toggle", "search", "submit search",
  "sign in", "log in", "login", "my account", "back to top", "previous", "next",
  "change language", "select language", "share", "print", "download app",
];

// Containers whose contents should never be treated as CTAs.
const NON_CTA_CONTAINER_SELECTOR =
  '[class*="cookie" i], [id*="cookie" i], [class*="consent" i], [id*="consent" i], ' +
  '[class*="gdpr" i], [id*="gdpr" i], [aria-label*="cookie" i], [class*="banner-privacy" i]';

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isNonCtaText(text: string): boolean {
  const lower = text.toLowerCase();
  return NON_CTA_TEXT.some((p) => lower.includes(p));
}

/**
 * Extract calls-to-action and judge their strength.
 *
 * "Above the fold" is approximated by the header plus the first section/hero block —
 * we can't measure real viewport position without rendering, so the wording in the
 * report stays descriptive ("in the page header / opening section") rather than
 * claiming a pixel-accurate result.
 */
export function analyzeCta($: cheerio.CheerioAPI, baseUrl: string): CtaResult {
  const candidates: { text: string; href: string | null; aboveFold: boolean }[] = [];

  const aboveFoldRoots = [
    $("header").first(),
    $("section").first(),
    $("main").children().first(),
    $('[class*="hero" i]').first(),
    $('[class*="banner" i]').first(),
  ];

  const isAboveFold = (el: any): boolean =>
    aboveFoldRoots.some(($root) => $root.length > 0 && $root.find(el).length > 0);

  const excludedContainers = $(NON_CTA_CONTAINER_SELECTOR);
  const isInExcludedContainer = (el: any): boolean =>
    excludedContainers.length > 0 && excludedContainers.find(el).length > 0;

  $('a, button, input[type="submit"]').each((_i: number, el: any) => {
    const $el = $(el);
    const tag = (el.tagName || el.name || "").toLowerCase();
    const text = normalizeText(
      tag === "input" ? ($el.attr("value") || "") : ($el.text() || $el.attr("aria-label") || "")
    );
    if (!text || text.length > 60) return;
    if (isNonCtaText(text)) return;
    if (isInExcludedContainer(el)) return;

    const cls = `${$el.attr("class") || ""} ${$el.attr("id") || ""}`.toLowerCase();
    if (/cookie|consent|gdpr/.test(cls)) return;

    const lower = text.toLowerCase();
    const looksLikeButton = tag === "button" || tag === "input" || /\bbtn\b|button|cta/.test(cls);
    const hasIntentPhrase = HIGH_INTENT_CTA.some((p) => lower.includes(p)) || LOW_INTENT_CTA.some((p) => lower.includes(p));

    if (!looksLikeButton && !hasIntentPhrase) return;

    candidates.push({
      text,
      href: $el.attr("href") || null,
      aboveFold: isAboveFold(el),
    });
  });

  if (candidates.length === 0) {
    return {
      ctaTexts: [], primaryCTA: null, primaryCTAHref: null, ctaStrength: "weak",
      ctaAboveFold: false, ctaCount: 0, competingCtas: false, competingCtaTexts: [],
    };
  }

  const scoreOf = (text: string): number => {
    const lower = text.toLowerCase();
    if (HIGH_INTENT_CTA.some((p) => lower.includes(p))) return 2;
    if (LOW_INTENT_CTA.some((p) => lower.includes(p))) return 0;
    return 1;
  };

  // Primary CTA: the highest-intent one, preferring anything in the opening screen.
  const ranked = [...candidates].sort((a, b) => {
    const s = scoreOf(b.text) - scoreOf(a.text);
    if (s !== 0) return s;
    return Number(b.aboveFold) - Number(a.aboveFold);
  });
  const primary = ranked[0];

  const highIntentAboveFold = candidates.some((c) => c.aboveFold && scoreOf(c.text) === 2);
  const highIntentAnywhere = candidates.some((c) => scoreOf(c.text) === 2);
  const anyAboveFold = candidates.some((c) => c.aboveFold);

  let strength: "strong" | "medium" | "weak";
  if (highIntentAboveFold) strength = "strong";
  else if (highIntentAnywhere || anyAboveFold) strength = "medium";
  else strength = "weak";

  let primaryHref: string | null = null;
  if (primary.href) {
    try {
      const resolved = new URL(primary.href, baseUrl);
      if (resolved.protocol === "http:" || resolved.protocol === "https:") primaryHref = resolved.toString();
      else primaryHref = primary.href; // tel:/mailto: — still a valid conversion action
    } catch { /* ignore malformed href */ }
  }

  const uniqueTexts = [...new Set(candidates.map((c) => c.text))].slice(0, 12);

  // Competing actions: distinct high-intent CTAs sharing the opening screen. Compared
  // case-insensitively so "Book Now" and "book now" count as the same action being
  // repeated (which is fine) rather than two competing ones.
  const highIntentAboveFoldTexts = [
    ...new Set(
      candidates
        .filter((c) => c.aboveFold && scoreOf(c.text) === 2)
        .map((c) => c.text.trim())
    ),
  ];
  const competingCtas = highIntentAboveFoldTexts.length >= 2;

  return {
    ctaTexts: uniqueTexts,
    primaryCTA: primary.text,
    primaryCTAHref: primaryHref,
    ctaStrength: strength,
    ctaAboveFold: anyAboveFold,
    ctaCount: candidates.length,
    competingCtas,
    competingCtaTexts: highIntentAboveFoldTexts.slice(0, 4),
  };
}

// ---------------------------------------------------------------------------
// 4. Lead magnet detection
// ---------------------------------------------------------------------------

export interface LeadMagnetResult {
  hasLeadMagnet: boolean;
  leadMagnetType: string | null;
}

const LEAD_MAGNET_PATTERNS: { type: string; patterns: RegExp[] }[] = [
  { type: "Free consultation", patterns: [/free\s+(consultation|consult|discovery\s+call|strategy\s+(call|session))/i] },
  { type: "Free quote or estimate", patterns: [/free\s+(quote|estimate|proposal|valuation)/i, /no[-\s]obligation\s+quote/i] },
  { type: "Free audit or assessment", patterns: [/free\s+(audit|assessment|analysis|review|health\s+check|evaluation)/i] },
  { type: "Downloadable guide", patterns: [/free\s+(guide|ebook|e-book|report|whitepaper|white\s+paper)/i, /download\s+(our|the|your|free)\s+\w*\s*(guide|ebook|report|whitepaper)/i] },
  { type: "Checklist or template", patterns: [/free\s+(checklist|template|worksheet|toolkit|cheat\s*sheet|planner)/i] },
  { type: "Webinar or training", patterns: [/free\s+(webinar|training|workshop|masterclass|course|demo)/i, /register\s+for\s+(our|the)\s+free/i] },
  { type: "Calculator or quiz", patterns: [/\b(cost|price|savings|roi|mortgage|loan)\s+calculator\b/i, /\bfree\s+(quiz|calculator|assessment\s+tool)\b/i] },
  { type: "Free trial", patterns: [/free\s+trial/i, /try\s+(it\s+)?free\s+for/i] },
  { type: "Free sample or first session", patterns: [/free\s+(sample|trial\s+class|first\s+(session|lesson|class|visit))/i] },
];

/**
 * Look for a value-exchange offer — the thing a visitor gets in return for their
 * contact details. Scanned against visible text so a stray word in a script doesn't
 * trigger a false positive.
 */
export function detectLeadMagnet(visibleTextAllPages: string, allHtml: string): LeadMagnetResult {
  for (const { type, patterns } of LEAD_MAGNET_PATTERNS) {
    if (patterns.some((re) => re.test(visibleTextAllPages))) {
      return { hasLeadMagnet: true, leadMagnetType: type };
    }
  }
  // A gated PDF linked with download intent also counts.
  if (/href="[^"]*\.pdf"/i.test(allHtml) && /\b(download|free)\b/i.test(visibleTextAllPages)) {
    return { hasLeadMagnet: true, leadMagnetType: "Downloadable PDF" };
  }
  return { hasLeadMagnet: false, leadMagnetType: null };
}

// ---------------------------------------------------------------------------
// 5. Conversion popup / overlay detection
// ---------------------------------------------------------------------------

export interface PopupResult {
  hasConversionPopup: boolean;
  popupTechnology: string | null;
}

/**
 * Detect an email-capture overlay, either via a known popup vendor or via a modal
 * container that actually holds an email input (structural fallback for hand-rolled
 * popups). A modal with no email field is a cookie notice, not a conversion tool.
 */
export function detectConversionPopup(pages: CrawledPage[], tech: MarketingTechResult): PopupResult {
  const vendor = tech.techByCategory.cro[0];
  if (vendor) return { hasConversionPopup: true, popupTechnology: vendor };

  for (const page of pages) {
    const containers = page.$('[class*="modal" i], [id*="modal" i], [class*="popup" i], [id*="popup" i], [class*="lightbox" i], [class*="overlay" i]');
    let found = false;
    containers.each((_i: number, el: any) => {
      if (found) return;
      const $el = page.$(el);
      const inner = ($el.html() || "").toLowerCase();
      // Exclude consent banners — they're compliance, not conversion.
      const text = ($el.text() || "").toLowerCase();
      if (/cookie|consent|gdpr|privacy policy/.test(text) && !/subscribe|newsletter|discount|offer/.test(text)) return;
      if (inner.includes('type="email"') || inner.includes('name="email"')) found = true;
    });
    if (found) return { hasConversionPopup: true, popupTechnology: null };
  }

  return { hasConversionPopup: false, popupTechnology: null };
}

// ---------------------------------------------------------------------------
// 6. Conversion path
// ---------------------------------------------------------------------------

export interface ConversionPathResult {
  hasClearConversionPath: boolean | null;
  conversionPathIssues: string[];
  conversionDestinationType: "form" | "booking" | "phone" | "email" | "none" | null;
}

const BOOKING_SIGNATURES = [
  "calendly.com", "acuityscheduling.com", "cal.com/", "setmore.com", "booksy.com",
  "fresha.com", "vagaro.com", "mindbodyonline.com", "squareup.com/appointments",
  "opentable.com", "resy.com", "zocdoc.com", "doctolib.com", "simplybook.me",
  "youcanbook.me", "tidycal.com", "hubspot.com/meetings", "jane.app", "cliniko.com",
];

/**
 * Follow the primary CTA and confirm a visitor can actually convert at the other end.
 *
 * This is the single most valuable marketing finding we can produce for free: a site
 * can pass every individual check (has a CTA, has a form, has analytics) and still
 * leak every lead because the button leads somewhere with no way to enquire.
 *
 * Returns null when there's no CTA to follow — "unknown", not "broken".
 */
export async function analyzeConversionPath(
  cta: CtaResult,
  pages: CrawledPage[],
  baseHostname: string
): Promise<ConversionPathResult> {
  const issues: string[] = [];

  if (!cta.primaryCTA) {
    return {
      hasClearConversionPath: false,
      conversionPathIssues: ["No clear primary call-to-action was detected on the homepage"],
      conversionDestinationType: null,
    };
  }

  const href = cta.primaryCTAHref;

  if (!href) {
    issues.push("The primary call-to-action does not link anywhere we could follow");
    return { hasClearConversionPath: false, conversionPathIssues: issues, conversionDestinationType: null };
  }

  // A CTA that dials or opens email IS a complete conversion path, just a manual one.
  if (/^tel:/i.test(href)) {
    return { hasClearConversionPath: true, conversionPathIssues: [], conversionDestinationType: "phone" };
  }
  if (/^mailto:/i.test(href)) {
    return { hasClearConversionPath: true, conversionPathIssues: [], conversionDestinationType: "email" };
  }

  let destination$: cheerio.CheerioAPI | null = null;
  let destinationHtml = "";

  try {
    const resolved = new URL(href);

    // Off-site CTA pointing at a known booking platform = a working path.
    if (!isSameSite(resolved.hostname, baseHostname)) {
      if (BOOKING_SIGNATURES.some((s) => href.toLowerCase().includes(s))) {
        return { hasClearConversionPath: true, conversionPathIssues: [], conversionDestinationType: "booking" };
      }
      // Some other external destination — we can't judge it, so don't.
      return { hasClearConversionPath: null, conversionPathIssues: [], conversionDestinationType: null };
    }

    // Same-page anchor or the homepage itself — evaluate the homepage we already have.
    const homeUrl = pages[0]?.url || "";
    const sameAsHome = resolved.toString().replace(/\/+$/, "") === homeUrl.replace(/\/+$/, "");
    const alreadyCrawled = pages.find((p) => p.url.replace(/\/+$/, "") === resolved.toString().replace(/\/+$/, ""));

    if (sameAsHome || alreadyCrawled) {
      destination$ = (alreadyCrawled || pages[0]).$;
      destinationHtml = (destination$.html() || "").toLowerCase();
    } else {
      const res = await safeGet(resolved.toString(), { timeout: 9000, maxBytes: 2 * 1024 * 1024 });
      if (!res) {
        // Couldn't load it — report as unknown rather than accusing the site.
        return { hasClearConversionPath: null, conversionPathIssues: [], conversionDestinationType: null };
      }
      if (res.status >= 400) {
        issues.push(`The primary call-to-action leads to a page that returned an error (HTTP ${res.status})`);
        return { hasClearConversionPath: false, conversionPathIssues: issues, conversionDestinationType: "none" };
      }
      destination$ = cheerio.load(res.data);
      destinationHtml = (destination$.html() || "").toLowerCase();
    }
  } catch {
    return { hasClearConversionPath: null, conversionPathIssues: [], conversionDestinationType: null };
  }

  if (!destination$) {
    return { hasClearConversionPath: null, conversionPathIssues: [], conversionDestinationType: null };
  }

  // Does the destination actually let someone convert?
  if (BOOKING_SIGNATURES.some((s) => destinationHtml.includes(s))) {
    return { hasClearConversionPath: true, conversionPathIssues: [], conversionDestinationType: "booking" };
  }

  const hasCaptureForm = destination$("form").toArray().some((form) => {
    const html = (destination$!(form).html() || "").toLowerCase();
    return html.includes('type="email"') || html.includes('name="email"') ||
           html.includes('type="tel"') || html.includes('name="phone"');
  });
  if (hasCaptureForm) {
    return { hasClearConversionPath: true, conversionPathIssues: [], conversionDestinationType: "form" };
  }

  if (destination$('a[href^="tel:"]').length > 0) {
    return { hasClearConversionPath: true, conversionPathIssues: [], conversionDestinationType: "phone" };
  }
  if (destination$('a[href^="mailto:"]').length > 0) {
    return { hasClearConversionPath: true, conversionPathIssues: [], conversionDestinationType: "email" };
  }

  issues.push("The primary call-to-action leads to a page with no visible enquiry form, booking widget or contact link");
  return { hasClearConversionPath: false, conversionPathIssues: issues, conversionDestinationType: "none" };
}

// ---------------------------------------------------------------------------
// 7. Social presence quality
// ---------------------------------------------------------------------------

export interface SocialQualityResult {
  socialPlatformCount: number;
  socialPlatforms: string[];
  socialPresenceStrength: "strong" | "moderate" | "weak";
}

const PLATFORM_MATCHERS: { name: string; test: RegExp }[] = [
  { name: "Facebook", test: /facebook\.com/i },
  { name: "Instagram", test: /instagram\.com/i },
  { name: "LinkedIn", test: /linkedin\.com/i },
  { name: "X (Twitter)", test: /(twitter\.com|(?:^|\/\/)(?:www\.)?x\.com)/i },
  { name: "YouTube", test: /youtube\.com|youtu\.be/i },
  { name: "TikTok", test: /tiktok\.com/i },
];

/**
 * Roll the raw social link list up into distinct platforms.
 *
 * Counting links overstates presence — a site linking Facebook four times in header,
 * footer and two buttons is present on ONE platform, not four.
 */
export function analyzeSocialQuality(socialLinks: string[]): SocialQualityResult {
  const platforms = new Set<string>();
  for (const link of socialLinks) {
    for (const { name, test } of PLATFORM_MATCHERS) {
      if (test.test(link)) platforms.add(name);
    }
  }
  const list = [...platforms];
  const strength: "strong" | "moderate" | "weak" =
    list.length >= 3 ? "strong" : list.length === 2 ? "moderate" : "weak";

  return { socialPlatformCount: list.length, socialPlatforms: list, socialPresenceStrength: strength };
}
