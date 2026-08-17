import axios from "axios";
import * as cheerio from "cheerio";
import { URL } from "url";
import logger from "../utils/logger";
import { detectLanguage } from "../utils/languageDetection";
import { safeHttpAgent, safeHttpsAgent, isUrlSafe, isSameSite } from "./httpClient";
import {
  analyzeRobotsTxt,
  analyzeSitemap,
  checkHttpsRedirect,
  checkInternalLinks,
  analyzeOnPageSeo,
  type CrawledPage,
} from "./seoAnalysis";
import {
  detectMarketingTech,
  analyzeFormFriction,
  analyzeCta,
  detectLeadMagnet,
  detectConversionPopup,
  analyzeConversionPath,
  analyzeSocialQuality,
  type TechCategory,
} from "./marketingAnalysis";

export interface WebsiteData {
  title: string;
  description: string;
  headings: string[];
  hasOnlineBooking: boolean;
  hasContactForm: boolean;
  socialLinks: string[];
  technologies: string[];
  industry: string;
  emails: string[];
  phones: string[];
  // New enrichment signals
  isMobileFriendly: boolean;
  hasSSL: boolean;
  hasMetaDescription: boolean;
  pageLoadTimeMs: number;     // homepage response time in ms
  pageSizeKB: number;         // homepage size in KB
  copyrightYear: number | null;  // detected copyright year (null if not found)
  isSPA: boolean;             // true = JS-rendered site (enrichment data may be partial)
  isParkedDomain: boolean;    // true = domain is parked/for sale/under construction
  _siteDown?: boolean;
  // Ad & analytics detection
  hasGoogleAds: boolean;      // Google Ads tag detected (AW- conversion tracking)
  hasFacebookPixel: boolean;  // Meta/Facebook Pixel detected
  hasAnalytics: boolean;      // Google Analytics or GTM detected
  // Digital marketing signals
  hasLeadCaptureForm: boolean;   // Email signup, newsletter, gated content form
  hasOpenGraph: boolean;         // OG tags for social sharing (og:title, og:image)
  hasSchemaMarkup: boolean;      // Structured data (LocalBusiness, Organization, FAQ, etc.)
  hasEmailMarketing: boolean;    // Mailchimp, ConvertKit, HubSpot, Klaviyo, etc.
  hasCTA: boolean;               // Clear call-to-action button/form above the fold
  hasRetargeting: boolean;       // Any retargeting pixel beyond FB (TikTok, LinkedIn, Twitter, Pinterest)
  // Language detection
  detectedLanguage: string;      // ISO 639-3 language code detected from website content (default: "eng")

  // ===== SEO analysis (see seoAnalysis.ts) =====
  // Technical
  hasRobotsTxt: boolean;
  robotsBlocksSite: boolean;
  robotsSitemapDeclared: boolean;
  robotsBlockedPaths: string[];
  hasSitemap: boolean;
  sitemapUrl: string | null;
  sitemapUrlCount: number;
  isSitemapIndex: boolean;
  redirectsToHttps: boolean | null;   // null = HTTP endpoint unreachable, so unknown
  internalLinkCount: number;
  checkedLinkCount: number;
  brokenInternalLinks: string[];
  redirectingInternalLinks: string[];
  // On-page
  titleLength: number;
  hasTitle: boolean;
  h1Count: number;
  headingCounts: { h1: number; h2: number; h3: number; h4: number; h5: number; h6: number };
  emptyHeadingCount: number;
  hasHeadingHierarchyIssues: boolean;
  headingIssues: string[];
  hasCanonical: boolean;
  canonicalUrl: string | null;
  canonicalIssue: string | null;
  isIndexable: boolean;
  hasNoindex: boolean;
  hasNofollow: boolean;
  noindexSource: string | null;
  imageCount: number;
  imagesWithAlt: number;
  imagesWithoutAlt: number;
  emptyAltCount: number;
  altTextCoverage: number;
  wordCount: number;
  isThinContent: boolean;
  pagesAnalyzed: number;
  duplicateTitleCount: number;
  duplicateMetaDescriptionCount: number;
  duplicateH1Count: number;
  duplicateTitles: string[];
  duplicateH1s: string[];
  // Structured data + international
  schemaTypes: string[];
  hasLocalBusinessSchema: boolean;
  hasHreflang: boolean;
  hreflangLanguages: string[];
  hreflangIssues: string[];
  // Local / NAP
  hasBusinessAddress: boolean;
  hasVisiblePhone: boolean;
  napConsistency: "strong" | "partial" | "weak";

  // ===== Digital marketing analysis (see marketingAnalysis.ts) =====
  marketingTechnologies: string[];
  techByCategory: Record<TechCategory, string[]>;
  hasClarity: boolean;
  hasHotjar: boolean;
  hasMicrosoftUET: boolean;
  hasHubSpot: boolean;
  hasTagManager: boolean;
  hasLiveChat: boolean;
  hasHeatmapTool: boolean;
  formFieldCount: number;
  requiredFieldCount: number;
  formFriction: "low" | "medium" | "high" | null;
  formHasPhoneRequired: boolean;
  ctaTexts: string[];
  primaryCTA: string | null;
  ctaStrength: "strong" | "medium" | "weak" | null;
  ctaAboveFold: boolean;
  ctaCount: number;
  competingCtas: boolean;
  competingCtaTexts: string[];
  hasLeadMagnet: boolean;
  leadMagnetType: string | null;
  hasConversionPopup: boolean;
  popupTechnology: string | null;
  hasClearConversionPath: boolean | null;
  conversionPathIssues: string[];
  conversionDestinationType: "form" | "booking" | "phone" | "email" | "none" | null;
  socialPlatformCount: number;
  socialPlatforms: string[];
  socialPresenceStrength: "strong" | "moderate" | "weak";
}

// SSRF protection (safe agents + isUrlSafe) now lives in ./httpClient so the SEO and
// marketing analyzers reuse the exact same guarantees instead of duplicating them.

// Pages fetched per lead beyond the homepage. Kept deliberately small: enrichment runs
// 5 leads concurrently in the background, so each extra page multiplies out fast.
const MAX_CRAWL_PAGES = 6;
// Internal URLs status-checked for the broken-link report.
const MAX_LINK_CHECKS = 20;

// Nav/footer paths worth crawling for SEO analysis — these are where a local business
// puts the content that matters (services, location, about), and they're what make
// duplicate-metadata and alt-text coverage meaningful across more than one page.
const PRIORITY_PAGE_PATTERNS = [
  /contact|kontakt/i,
  /service|leistung|servicio|servizi|prestation/i,
  /about|about-us|company|ueber|über|nosotros|chi-siamo|a-propos/i,
  /location|standort|ubicacion|find-us|visit/i,
  /price|pricing|tarif|preise|precio/i,
];

/**
 * Fetch and parse website content to extract business information
 * Scrapes homepage + attempts to find and scrape the contact page for better data
 */
export async function scrapeWebsite(
  websiteUrl: string
): Promise<Partial<WebsiteData> | null> {
  try {
    if (!websiteUrl || !websiteUrl.startsWith("http")) {
      return null;
    }

    // SSRF protection: block internal/private IPs
    const safe = await isUrlSafe(websiteUrl);
    if (!safe) {
      logger.warn({ url: websiteUrl }, "Blocked SSRF attempt — URL resolves to private/internal IP");
      return null;
    }

    // Quick connectivity check: if the site is completely down, return a minimal object
    // so we can distinguish "broken/down site" from "no website at all"
    // Strategy: Try HEAD first, then GET as fallback (some sites block HEAD or return 503 via WAF/Cloudflare)
    let siteReachable = false;
    const connectHeaders = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    };
    try {
      await axios.head(websiteUrl, {
        timeout: 8000,
        maxRedirects: 5,
        httpAgent: safeHttpAgent,
        httpsAgent: safeHttpsAgent,
        headers: connectHeaders,
        validateStatus: () => true, // Accept ANY status — if the server responds at all, it's up
      });
      siteReachable = true;
    } catch {
      // HEAD failed — try GET (some servers/WAFs block HEAD entirely)
      try {
        await axios.get(websiteUrl, {
          timeout: 8000,
          maxRedirects: 5,
          httpAgent: safeHttpAgent,
          httpsAgent: safeHttpsAgent,
          maxContentLength: 100 * 1024, // only need first 100KB to confirm site is up
          headers: connectHeaders,
          validateStatus: () => true,
        });
        siteReachable = true;
      } catch {
        // Both failed — site is genuinely unreachable
      }
    }

    if (!siteReachable) {
      logger.info({ url: websiteUrl }, "Website unreachable — returning broken site marker");
      return {
        title: "",
        description: "",
        headings: [],
        hasOnlineBooking: false,
        hasContactForm: false,
        socialLinks: [],
        technologies: [],
        industry: "",
        emails: [],
        phones: [],
        _siteDown: true,
      } as Partial<WebsiteData> & { _siteDown?: boolean };
    }

    let finalUrl = websiteUrl; // Track the final URL after redirects (for SSL detection)

    const fetchPage = async (
      url: string,
      trackFinalUrl = false
    ): Promise<{ $: cheerio.CheerioAPI; loadTimeMs: number; sizeKB: number; pageUrl: string; headers: Record<string, any> } | null> => {
      try {
        const startTime = Date.now();
        const response = await axios.get(url, {
          timeout: 10000,
          maxRedirects: 5,
          httpAgent: safeHttpAgent,
          httpsAgent: safeHttpsAgent,
          maxContentLength: 2 * 1024 * 1024, // 2MB max — skip huge pages
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
          },
        });
        const loadTimeMs = Date.now() - startTime;
        const responseUrl: string = response.request?.res?.responseUrl || url;
        // Capture final URL after redirects (for SSL detection)
        if (trackFinalUrl && response.request?.res?.responseUrl) {
          finalUrl = response.request.res.responseUrl;
        }
        // Only parse HTML responses — skip PDFs, images, binary files
        const contentType = response.headers["content-type"] || "";
        if (!contentType.includes("text/html") && !contentType.includes("text/plain") && !contentType.includes("application/xhtml")) {
          return null;
        }
        if (typeof response.data !== "string") return null;
        const sizeKB = Math.round(Buffer.byteLength(response.data, "utf8") / 1024);
        return {
          $: cheerio.load(response.data),
          loadTimeMs,
          sizeKB,
          pageUrl: responseUrl,
          headers: response.headers as Record<string, any>,
        };
      } catch {
        return null;
      }
    };

    // Fetch homepage
    const homeResult = await fetchPage(websiteUrl, true);
    if (!homeResult) return null;
    const { $, loadTimeMs: pageLoadTimeMs, sizeKB: pageSizeKB } = homeResult;

    // Every page we successfully parse, in crawl order. Analyzers treat index 0 as the
    // homepage, so it must stay first.
    const crawledPages: CrawledPage[] = [
      { url: homeResult.pageUrl, $, headers: homeResult.headers },
    ];
    const fetchedUrls = new Set<string>([websiteUrl, homeResult.pageUrl]);

    // Try to find and fetch the contact page from homepage navigation
    let contactPage$: cheerio.CheerioAPI | null = null;
    const baseUrl = new URL(websiteUrl);

    // Collect internal links from nav and footer (where contact pages are always linked).
    // Compare hosts with isSameSite: a site requested as www.example.com that
    // canonicalises to example.com would otherwise treat all of its own links as
    // external and never crawl a second page.
    const navFooterLinks: string[] = [];
    const collectLinks = (selector: string) => {
      $(selector).each((_i: number, el: any) => {
        const href = $(el).attr("href");
        if (!href) return;
        try {
          const resolved = new URL(href, homeResult.pageUrl);
          // Only same-domain, short internal paths (skip external, anchors, deep paths, assets)
          if (!isSameSite(resolved.hostname, baseUrl.hostname)) return;
          const path = resolved.pathname;
          if (path === "/" || path === baseUrl.pathname) return;
          // Skip file extensions (images, PDFs, etc.)
          if (/\.\w{2,4}$/.test(path) && !/\.html?$/.test(path)) return;
          // Only short paths (1-2 segments) — contact pages are top-level, not /blog/some-post
          const segments = path.split("/").filter(Boolean);
          if (segments.length > 2) return;
          const normalized = resolved.toString();
          if (!navFooterLinks.includes(normalized)) navFooterLinks.push(normalized);
        } catch { /* ignore bad URLs */ }
      });
    };

    collectLinks("nav a[href], header a[href], footer a[href]");

    // Fallback for sites that don't use semantic nav/header/footer elements (common on
    // page-builder templates). Without this they'd never get a second page crawled, which
    // silently disables duplicate-metadata and internal-link analysis for them.
    if (navFooterLinks.length === 0) {
      collectLinks("a[href]");
    }

    // Quick check: "contact" and "kontakt" roots cover ~90% of languages
    // ("contact" matches: English, Spanish contacto, Portuguese contato, Italian contatti, French contactez)
    // ("kontakt" matches: German, Polish, Czech, Swedish, Norwegian, Danish)
    const quickContactMatch = navFooterLinks.find(url => /contact|kontakt/i.test(url));

    if (quickContactMatch) {
      // Fast path: found a likely contact page URL
      const contactSafe = await isUrlSafe(quickContactMatch);
      if (contactSafe) {
        const result = await fetchPage(quickContactMatch);
        if (result) {
          contactPage$ = result.$;
          crawledPages.push({ url: result.pageUrl, $: result.$, headers: result.headers });
          fetchedUrls.add(quickContactMatch);
          fetchedUrls.add(result.pageUrl);
        }
      }
    }

    if (!contactPage$) {
      // Structural fallback: fetch up to 3 nav/footer pages, check if any has a form with email+textarea
      // Skip the URL that already failed in fast path
      const candidates = navFooterLinks.filter(url => url !== quickContactMatch).slice(0, 3);
      for (const candidateUrl of candidates) {
        const candidateSafe = await isUrlSafe(candidateUrl);
        if (!candidateSafe) continue;
        const result = await fetchPage(candidateUrl);
        if (!result) continue;
        const candidate$ = result.$;
        // Every page we fetch feeds the SEO analysis, even if it turns out not to be the
        // contact page — so record it before deciding.
        crawledPages.push({ url: result.pageUrl, $: candidate$, headers: result.headers });
        fetchedUrls.add(candidateUrl);
        fetchedUrls.add(result.pageUrl);
        // Check if this page has a contact form (email input + textarea) or mailto link
        const hasForm = candidate$("form").toArray().some(form => {
          const html = candidate$(form).html()?.toLowerCase() || "";
          return (html.includes('type="email"') || html.includes('name="email"')) && html.includes("<textarea");
        });
        const hasMailto = candidate$("a[href^='mailto:']").length > 0;
        if (hasForm || hasMailto) {
          contactPage$ = candidate$;
          break;
        }
      }
    }

    // Crawl a few more high-value pages (services, about, location, pricing). These make
    // the SEO analysis meaningful — duplicate metadata, alt-text coverage and internal
    // link health can't be judged from a single page — and they surface contact details
    // the homepage doesn't carry. Hard-capped by MAX_CRAWL_PAGES.
    const priorityCandidates = navFooterLinks.filter(
      (url) => !fetchedUrls.has(url) && PRIORITY_PAGE_PATTERNS.some((re) => re.test(url))
    );
    // Fall back to any remaining nav link so single-page-nav sites still get a second page.
    const extraCandidates = [
      ...priorityCandidates,
      ...navFooterLinks.filter((url) => !fetchedUrls.has(url) && !priorityCandidates.includes(url)),
    ];

    for (const candidateUrl of extraCandidates) {
      if (crawledPages.length >= MAX_CRAWL_PAGES) break;
      if (fetchedUrls.has(candidateUrl)) continue;
      if (!(await isUrlSafe(candidateUrl))) continue;
      fetchedUrls.add(candidateUrl);
      const result = await fetchPage(candidateUrl);
      if (!result) continue;
      // A redirect can land two nav links on the same page — don't analyse it twice.
      if (fetchedUrls.has(result.pageUrl) && result.pageUrl !== candidateUrl) continue;
      fetchedUrls.add(result.pageUrl);
      crawledPages.push({ url: result.pageUrl, $: result.$, headers: result.headers });
    }

    // Merge data from every crawled page (homepage first)
    const pages = crawledPages.map((p) => p.$);

    // Extract title and meta description (homepage only)
    const title = $("title").text() || $("h1").first().text() || "";
    const description =
      $('meta[name="description"]').attr("content") ||
      $("meta[property='og:description']").attr("content") ||
      "";

    // Extract main headings (homepage only)
    const headings: string[] = [];
    $("h1, h2, h3")
      .slice(0, 5)
      .each((_i: number, el: any) => {
        const text = $(el).text().trim();
        if (text) headings.push(text);
      });

    // Combine HTML and text from all pages for detection
    const allHtml = pages.map(p => p.html().toLowerCase()).join(" ");
    const allPageText = pages.map(p => p("body").text().toLowerCase()).join(" ");

    // Booking detection: check for known booking platform embeds/scripts/links + structural patterns
    const hasOnlineBooking = await (async () => {
      // 1. Known booking platform signatures in HTML (iframes, scripts, links) — works in any language
      const bookingPlatforms = [
        // General scheduling
        "calendly.com", "acuityscheduling.com", "tidycal.com", "cal.com/",
        "youcanbook.me", "zcal.co", "savvycal.com", "doodle.com",
        "picktime.com", "10to8.com", "setmore.com", "appointy.com",
        "simplybook.me", "genbook.com", "schedulicity.com",
        // Square / business
        "squareup.com/appointments", "square.site",
        // Restaurant / food
        "opentable.com", "resy.com", "yelp.com/reservations", "thefork.com",
        // Beauty / salon / spa
        "booksy.com", "fresha.com", "vagaro.com", "styleseat.com",
        "gettimely.com", "phorest.com", "yclients.com", "treatwell.com",
        // Fitness / wellness
        "mindbodyonline.com", "mindbody.io", "classpass.com",
        // Health / medical
        "zocdoc.com", "doctolib.com", "hotdoc.com.au", "practo.com",
        "jane.app", "cliniko.com", "therapynotes.com", "simplepractice.com",
        // CRM / B2B scheduling
        "hubspot.com/meetings", "zoho.com/bookings", "chilipiper.com",
        "nylas.com/scheduler",
        // Microsoft
        "microsoft.com/bookings",
        // Service businesses
        "bookingkoala.com",
      ];
      if (bookingPlatforms.some(p => allHtml.includes(p))) return true;

      // 2. Structural signals: booking/reservation CSS classes BUT only if they contain
      // an interactive element (iframe, form, button, input) — a plain div with "booking" in
      // the class that just says "call us" should NOT count
      for (const p of pages) {
        const bookingElements = p("[class*='booking'], [id*='booking'], [class*='reservat'], [id*='reservat'], [data-booking], [data-reservation]");
        let hasInteractive = false;
        bookingElements.each((_i: number, el: any) => {
          const inner = p(el).html()?.toLowerCase() || "";
          if (inner.includes("<iframe") || inner.includes("<form") || inner.includes("<input") || inner.includes("<select") || inner.includes("<button")) {
            hasInteractive = true;
          }
        });
        if (hasInteractive) return true;
      }

      // 3. Schema.org structured data for reservations
      if (allHtml.includes("reserveaction") || allHtml.includes("bookingaction") || allHtml.includes("scheduleaction")) return true;

      // 4. Links with booking-related URL paths — fetch the actual page and check
      // if it has a real booking system (form, iframe, platform embed), not just a phone number
      for (const p of pages) {
        const bookingLinks: string[] = [];
        p("a[href*='/book'], a[href*='/reserve'], a[href*='/appointment'], a[href*='/schedule'], a[href*='/booking']").each((_i: number, el: any) => {
          const href = p(el).attr("href");
          if (!href) return;
          try {
            const resolved = new URL(href, baseUrl);
            if (resolved.hostname !== baseUrl.hostname) return;
            if (!bookingLinks.includes(resolved.toString())) {
              bookingLinks.push(resolved.toString());
            }
          } catch { /* skip bad URLs */ }
        });

        // Fetch up to 2 booking-path pages and verify they have real booking elements
        for (const bookingUrl of bookingLinks.slice(0, 2)) {
          const urlSafe = await isUrlSafe(bookingUrl);
          if (!urlSafe) continue;
          const bookingResult = await fetchPage(bookingUrl);
          if (!bookingResult) continue;
          const bookingPage$ = bookingResult.$;
          const pageHtml = bookingPage$.html().toLowerCase();

          // Check for platform signatures on the booking page
          if (bookingPlatforms.some(bp => pageHtml.includes(bp))) return true;

          // Check for interactive booking elements: forms with date/time inputs, iframes, calendar widgets
          const hasBookingForm = bookingPage$("form").toArray().some(form => {
            const formHtml = bookingPage$(form).html()?.toLowerCase() || "";
            return formHtml.includes('type="date"') || formHtml.includes('type="time"') ||
                   formHtml.includes('type="datetime') || formHtml.includes("calendar") ||
                   formHtml.includes("datepicker") || formHtml.includes("timeslot") ||
                   formHtml.includes("time-slot") || formHtml.includes("availability");
          });
          if (hasBookingForm) return true;

          // Check for booking iframes or calendar widgets on the page
          if (bookingPage$("iframe").length > 0) {
            const iframeSrc = bookingPage$("iframe").toArray().map(el => bookingPage$(el).attr("src") || "").join(" ").toLowerCase();
            if (bookingPlatforms.some(bp => iframeSrc.includes(bp)) || iframeSrc.includes("booking") || iframeSrc.includes("schedule") || iframeSrc.includes("calendar")) {
              return true;
            }
          }

          // Page exists but has no booking system — just phone/text, skip it
        }
      }

      return false;
    })();

    // Contact form detection: structural HTML analysis (language-agnostic, checks all pages)
    const hasContactForm = (() => {
      for (const p of pages) {
        const forms = p("form");
        let hasRealContactForm = false;

        forms.each((_i: number, form: any) => {
          const formHtml = p(form).html()?.toLowerCase() || "";
          const hasEmailField = formHtml.includes('type="email"') || formHtml.includes('name="email"');
          const hasPhoneField = formHtml.includes('type="tel"') || formHtml.includes('name="phone"');
          const hasMessageField = formHtml.includes("<textarea");
          const hasNameField = formHtml.includes('name="name"') || formHtml.includes('name="full') ||
            formHtml.includes('type="text"');
          if ((hasEmailField || hasNameField || hasPhoneField) && hasMessageField) {
            hasRealContactForm = true;
          }
        });
        if (hasRealContactForm) return true;
      }

      // Check for known contact form platform embeds
      const contactPlatforms = [
        "typeform.com", "jotform.com", "wufoo.com", "formspree.io",
        "getform.io", "formsubmit.co", "netlify.com/forms", "hubspot.com/forms",
        "mailchimp.com", "constantcontact.com",
      ];
      if (contactPlatforms.some(p => allHtml.includes(p))) return true;

      // Check for live chat widgets (counts as a contact method)
      const chatPlatforms = [
        "tawk.to", "livechatinc.com", "livechat.com",
        "intercom.io", "intercomcdn.com",
        "drift.com", "driftt.com",
        "zendesk.com/embeddable", "zopim.com",
        "crisp.chat", "tidio.co", "freshchat.com",
        "olark.com", "smartsupp.com", "chatra.io",
        "helpscout.net/beacon", "hubspot.com/conversations",
      ];
      if (chatPlatforms.some(p => allHtml.includes(p))) return true;

      return false;
    })();

    // Extract social links (from all pages, deduplicated by platform profile)
    const rawSocialLinks: string[] = [];
    for (const p of pages) {
      p('a[href*="facebook.com"], a[href*="twitter.com"], a[href*="x.com"], a[href*="linkedin.com"], a[href*="instagram.com"], a[href*="youtube.com"], a[href*="tiktok.com"]').each(
        (_i: number, el: any) => {
          const href = p(el).attr("href");
          if (href && !rawSocialLinks.includes(href)) rawSocialLinks.push(href);
        }
      );
    }
    // Filter out individual posts/reels/videos — keep only profile/page links
    // Deduplicate by normalizing to base profile URL
    const socialLinks = [...new Set(
      rawSocialLinks
        .filter(url => {
          // Skip individual posts, reels, stories, status updates
          if (/\/reel\//i.test(url)) return false;
          if (/\/p\//i.test(url)) return false; // instagram posts
          if (/\/status\//i.test(url)) return false; // tweets
          if (/\/posts\//i.test(url)) return false; // facebook posts
          if (/\/watch\?/i.test(url)) return false; // youtube videos
          if (/\/video\//i.test(url)) return false; // tiktok videos
          if (/\/stories\//i.test(url)) return false;
          if (/\/share\//i.test(url)) return false;
          // Skip generic platform links (no profile path)
          if (/^https?:\/\/(www\.)?(facebook|twitter|x|instagram|linkedin|youtube|tiktok)\.com\/?$/i.test(url)) return false;
          return true;
        })
        .map(url => url.replace(/\?.*$/, "").replace(/\/$/, "")) // strip query params and trailing slash
    )].slice(0, 6); // max 6 unique profiles

    // Detect common technology indicators (expanded list)
    const technologies: string[] = [];
    if (allHtml.includes("shopify")) technologies.push("Shopify");
    if (allHtml.includes("wordpress") || allHtml.includes("wp-content")) technologies.push("WordPress");
    if (allHtml.includes("webflow")) technologies.push("Webflow");
    if (allHtml.includes("wix.com") || allHtml.includes("wixsite")) technologies.push("Wix");
    if (allHtml.includes("squarespace")) technologies.push("Squarespace");
    if (allHtml.includes("godaddy") || allHtml.includes("secureserver.net")) technologies.push("GoDaddy");
    if (allHtml.includes("weebly")) technologies.push("Weebly");
    if (allHtml.includes("duda.co") || allHtml.includes("dudaone")) technologies.push("Duda");
    if (allHtml.includes("joomla")) technologies.push("Joomla");
    if (allHtml.includes("drupal")) technologies.push("Drupal");

    // ===== NEW SIGNAL: Mobile-friendly detection =====
    const isMobileFriendly = (() => {
      const hasViewport = $('meta[name="viewport"]').length > 0;
      if (!hasViewport) return false;
      const viewportContent = ($('meta[name="viewport"]').attr("content") || "").toLowerCase();
      // Must contain "width=" — just having a viewport tag with no width= doesn't count
      return viewportContent.includes("width=");
    })();

    // ===== NEW SIGNAL: SSL detection =====
    // Check if site actually supports HTTPS — try the HTTPS version of the domain
    const hasSSL = await (async () => {
      if (finalUrl.startsWith("https://")) return true;
      // Site didn't redirect to HTTPS — try HTTPS directly
      try {
        const parsed = new URL(finalUrl);
        const httpsUrl = `https://${parsed.hostname}/`;
        await axios.head(httpsUrl, {
          timeout: 4000,
          maxRedirects: 2,
          httpAgent: safeHttpAgent,
          httpsAgent: safeHttpsAgent,
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
          validateStatus: (status) => status < 500,
        });
        return true;
      } catch {
        return false;
      }
    })();

    // ===== NEW SIGNAL: Meta description presence =====
    const hasMetaDescription = description.length >= 10;

    // ===== NEW SIGNAL: Copyright year detection =====
    const copyrightYear = (() => {
      // Check both HTML entities and visible text
      const yearMatches = allHtml.match(/(?:©|&copy;|\bcopyright\b)\s*(\d{4})/gi) ||
                          allPageText.match(/(?:©|\bcopyright\b)\s*(\d{4})/gi);
      if (!yearMatches || yearMatches.length === 0) return null;
      // Extract years and return the latest one
      const years = yearMatches.map(m => {
        const y = m.match(/(\d{4})/);
        return y ? parseInt(y[1], 10) : 0;
      }).filter(y => y >= 2000 && y <= new Date().getFullYear());
      return years.length > 0 ? Math.max(...years) : null;
    })();

    // ===== NEW SIGNAL: SPA detection =====
    const isSPA = (() => {
      // Check for common SPA framework markers
      if (allHtml.includes("__next_data__") || allHtml.includes("__next")) return true; // Next.js
      if (allHtml.includes("__nuxt") || allHtml.includes("nuxt")) return true; // Nuxt.js
      if (allHtml.includes('<div id="root">') || allHtml.includes('<div id="root"></div>')) return true; // React CRA
      if (allHtml.includes('<div id="app">') || allHtml.includes('<div id="app"></div>')) return true; // Vue
      if (allHtml.includes("ng-version") || allHtml.includes("ng-app")) return true; // Angular
      // Body has very little visible text but lots of scripts (JS-rendered page)
      const bodyText = $("body").text().replace(/\s+/g, " ").trim();
      const scriptCount = $("script").length;
      if (bodyText.length < 100 && scriptCount > 5) return true;
      return false;
    })();

    // ===== NEW SIGNAL: Parked domain detection =====
    const isParkedDomain = (() => {
      const parkedSignals = [
        "domain is for sale", "this domain is registered", "buy this domain",
        "domain may be for sale", "parked by", "parked domain", "parked free",
        "under construction", "coming soon", "website coming soon",
        "future home of", "this site is under development",
        "this website is for sale", "make an offer on this domain",
        "godaddy.com/forsale", "dan.com", "afternic.com", "sedo.com",
        "hugedomains.com", "undeveloped.com",
      ];
      return parkedSignals.some(s => allPageText.includes(s) || allHtml.includes(s));
    })();

    // Extract email addresses from all pages
    const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
    const rawEmails = (allHtml.match(emailRegex) || []);

    // Dedupe and filter out junk emails from libraries, frameworks, and code
    const junkDomains = [
      "example.com", "sentry.io", "wixpress.com", "wordpress.org",
      "greensock.com", "broofa.com", "github.com", "npmjs.com",
      "jquery.com", "google.com", "googleapis.com", "gstatic.com",
      "facebook.com", "twitter.com", "cloudflare.com", "jsdelivr.net",
      "w3.org", "schema.org", "mozilla.org", "apache.org",
      "bootstrapcdn.com", "fontawesome.com", "typekit.net",
    ];
    const junkPatterns = [
      /^noreply@/i, /^no-reply@/i, /^support@.*\.(js|css|json)/i,
      /\.png$/i, /\.jpg$/i, /\.gif$/i, /\.svg$/i, /\.webp$/i, /\.ico$/i,
      /\.js$/i, /\.css$/i, /\.json$/i, /\.woff$/i, /\.woff2$/i, /\.ttf$/i,
    ];

    // Valid TLDs — only keep emails with recognized top-level domains
    const validTlds = [
      "com", "net", "org", "io", "co", "us", "uk", "de", "es", "fr", "it", "nl",
      "be", "at", "ch", "pl", "pt", "se", "no", "dk", "fi", "ie", "cz", "ro",
      "hu", "bg", "hr", "sk", "lt", "lv", "ee", "si", "gr", "ru", "au", "nz",
      "ca", "mx", "br", "ar", "cl", "in", "jp", "kr", "cn", "tw", "hk", "sg",
      "za", "info", "biz", "me", "tv", "cc", "eu", "berlin", "london", "nyc",
      "app", "dev", "tech", "store", "shop", "online", "site", "xyz",
    ];

    // Extract website domain for matching
    let siteDomain = "";
    try {
      siteDomain = new URL(websiteUrl).hostname.replace(/^www\./, "").toLowerCase();
    } catch { /* ignore */ }

    const uniqueEmails = [...new Set(rawEmails)]
      .filter(e => {
        const lower = e.toLowerCase();
        const [localPart, domain] = lower.split("@");
        if (!localPart || !domain) return false;
        // Filter out junk domains
        if (junkDomains.some(d => lower.endsWith(`@${d}`) || lower.endsWith(`.${d}`))) return false;
        // Filter out junk patterns
        if (junkPatterns.some(p => p.test(lower))) return false;
        // Filter out very long emails (likely encoded data)
        if (e.length > 60) return false;
        // Local part too short (e.g. "a@domain.com") or only digits
        if (localPart.length < 2) return false;
        if (/^\d+$/.test(localPart)) return false;
        // Domain must have a recognized TLD
        const tld = domain.split(".").pop() || "";
        if (!validTlds.includes(tld)) return false;
        // Domain must have at least 2 parts (e.g. "company.com", not just "com")
        if (domain.split(".").length < 2) return false;
        // Reject if domain part before TLD is too short (e.g. "flags@2x.webp")
        const domainName = domain.split(".").slice(0, -1).join(".");
        if (domainName.length < 2) return false;
        return true;
      });

    // Prioritize: 1) emails matching website domain, 2) common business emails, 3) others
    const domainEmails = uniqueEmails.filter(e => {
      if (!siteDomain) return false;
      const emailDomain = e.split("@")[1]?.toLowerCase() || "";
      return emailDomain === siteDomain || siteDomain.includes(emailDomain) || emailDomain.includes(siteDomain);
    });

    const businessPrefixes = ["info", "contact", "hello", "office", "admin", "dr", "doctor", "team"];
    const businessEmails = uniqueEmails.filter(e => {
      const prefix = e.split("@")[0]?.toLowerCase() || "";
      return businessPrefixes.some(p => prefix === p || prefix.startsWith(p));
    });

    // Pick best emails: domain matches first, then business-looking ones, then rest
    const emails = [
      ...domainEmails,
      ...businessEmails.filter(e => !domainEmails.includes(e)),
      ...uniqueEmails.filter(e => !domainEmails.includes(e) && !businessEmails.includes(e)),
    ].slice(0, 5);

    // Extract phone numbers from all pages
    const telLinks: string[] = [];
    const visibleTexts: string[] = [];
    for (const p of pages) {
      p('a[href^="tel:"]').each((_i: number, el: any) => {
        const href = p(el).attr("href")?.replace("tel:", "").replace(/\s+/g, "").trim();
        if (href && !telLinks.includes(href)) telLinks.push(href);
      });
      const $bodyClone = p("body").clone();
      $bodyClone.find("script, style, noscript, svg, code").remove();
      visibleTexts.push($bodyClone.text());
    }
    const visibleText = visibleTexts.join(" ");

    // Priority 2: International format with + prefix (+34 931 87 32 36, +1 212-601-2693, +44 20 7946 0958, +33 1 23 45 67 89)
    const intlPhoneRegex = /\+\d{1,3}[-.\s]?\(?\d{1,5}\)?(?:[-.\s]?\d{1,5}){2,5}/g;
    const intlMatches = (visibleText.match(intlPhoneRegex) || []);

    // Priority 3: US/CA format with required separators: (XXX) XXX-XXXX or XXX-XXX-XXXX
    const usPhoneRegex = /(?:\(\d{3}\)\s?|\b\d{3}[-.])\d{3}[-.\s]?\d{4}\b/g;
    const usMatches = (visibleText.match(usPhoneRegex) || []);

    // Priority 4: European local formats (e.g. 93 387 38 75, 020 7946 0958) — only from visible text
    const euroLocalRegex = /\b0\d{1,4}[-.\s]?\d{2,5}(?:[-.\s]?\d{2,5}){1,3}\b/g;
    const euroMatches = (visibleText.match(euroLocalRegex) || [])
      .filter(p => {
        const digits = p.replace(/\D/g, "");
        return digits.length >= 9 && digits.length <= 13;
      });

    // Combine: tel links first (most reliable), then international, then US, then European local
    const allPhones = [...telLinks, ...intlMatches, ...usMatches, ...euroMatches];
    const phones = [...new Set(
      allPhones
        .map(p => p.replace(/\s+/g, " ").trim())
        .filter(p => {
          const digits = p.replace(/\D/g, "");
          // 7-15 digits (ITU international standard)
          if (digits.length < 7 || digits.length > 15) return false;
          // Reject all-same digits (e.g. 1111111111)
          if (/^(\d)\1+$/.test(digits)) return false;
          return true;
        })
    )].slice(0, 3);

    // Industry is set from the search niche (auto-find) or CSV column — not detected from HTML.
    // Scraper returns "Unknown" and the enrichment route overrides it with lead.industry if available.
    const industry = "Unknown";

    // ===== NEW SIGNAL: Google Ads detection =====
    const hasGoogleAds = (() => {
      // Google Ads conversion tracking uses AW- prefix in gtag config
      if (/gtag\s*\(\s*['"]config['"]\s*,\s*['"]AW-/i.test(allHtml)) return true;
      // Google Ads remarketing tag
      if (allHtml.includes("googleads.g.doubleclick.net") || allHtml.includes("google_conversion_id")) return true;
      if (/AW-\d{6,}/.test(allHtml)) return true;
      return false;
    })();

    // ===== NEW SIGNAL: Facebook/Meta Pixel detection =====
    const hasFacebookPixel = (() => {
      if (allHtml.includes("connect.facebook.net/en_US/fbevents.js") || allHtml.includes("connect.facebook.net/en_us/fbevents.js")) return true;
      if (/fbq\s*\(\s*['"]init['"]/i.test(allHtml)) return true;
      if (allHtml.includes("facebook.com/tr?") || allHtml.includes("facebook.com/tr/?")) return true;
      return false;
    })();

    // ===== NEW SIGNAL: Google Analytics / GTM detection =====
    const hasAnalytics = (() => {
      // Google Analytics 4 (G- measurement ID)
      if (/['"]G-[A-Z0-9]+['"]/i.test(allHtml)) return true;
      // Universal Analytics (UA- tracking ID)
      if (/['"]UA-\d+-\d+['"]/i.test(allHtml)) return true;
      // Google Tag Manager (GTM- container ID)
      if (/GTM-[A-Z0-9]+/i.test(allHtml)) return true;
      if (allHtml.includes("googletagmanager.com")) return true;
      if (allHtml.includes("google-analytics.com/analytics.js") || allHtml.includes("google-analytics.com/ga.js")) return true;
      return false;
    })();

    // ===== DIGITAL MARKETING SIGNALS =====

    // Lead capture form (email signup, newsletter, gated content — distinct from contact form)
    const hasLeadCaptureForm = (() => {
      // Known email marketing platform embeds
      const emailPlatforms = [
        "mailchimp.com", "list-manage.com", "convertkit.com", "beehiiv.com",
        "klaviyo.com", "hubspot.com/forms", "activecampaign.com", "drip.com",
        "mailerlite.com", "sendinblue.com", "brevo.com", "getresponse.com",
        "aweber.com", "constantcontact.com", "flodesk.com", "kit.com",
        "optinmonster.com", "sumo.com", "leadpages.com", "unbounce.com",
      ];
      if (emailPlatforms.some(p => allHtml.includes(p))) return true;

      // Forms with email input but NO textarea (= signup, not contact)
      for (const p of pages) {
        const forms = p("form");
        let hasSignup = false;
        forms.each((_i: number, form: any) => {
          const formHtml = p(form).html()?.toLowerCase() || "";
          const hasEmail = formHtml.includes('type="email"') || formHtml.includes('name="email"');
          const hasTextarea = formHtml.includes("<textarea");
          // Email field without message textarea = likely a signup form
          if (hasEmail && !hasTextarea) {
            hasSignup = true;
          }
        });
        if (hasSignup) return true;
      }

      // Popup/modal signup patterns
      if (allHtml.includes("subscribe") && allHtml.includes('type="email"')) return true;
      if (allHtml.includes("newsletter") && allHtml.includes('type="email"')) return true;

      return false;
    })();

    // Open Graph tags (for social sharing)
    const hasOpenGraph = (() => {
      const hasOgTitle = $('meta[property="og:title"]').length > 0;
      const hasOgImage = $('meta[property="og:image"]').length > 0;
      const hasOgDesc = $('meta[property="og:description"]').length > 0;
      // Need at least title + image for decent social sharing
      return hasOgTitle && hasOgImage;
    })();

    // Schema / structured data markup
    const hasSchemaMarkup = (() => {
      // JSON-LD (most common modern approach)
      if ($('script[type="application/ld+json"]').length > 0) return true;
      // Microdata
      if ($('[itemscope][itemtype*="schema.org"]').length > 0) return true;
      // RDFa
      if ($('[typeof][vocab*="schema.org"]').length > 0) return true;
      return false;
    })();

    // Email marketing tool integration (distinct from lead capture — checks for platform JS/pixels)
    const hasEmailMarketing = (() => {
      const platforms = [
        "mailchimp.com", "list-manage.com", "mc.us", // Mailchimp
        "convertkit.com", "kit.com",                  // ConvertKit/Kit
        "klaviyo.com",                                 // Klaviyo
        "hubspot.com", "hs-scripts.com", "hsforms.com", // HubSpot
        "activecampaign.com",                          // ActiveCampaign
        "drip.com",                                    // Drip
        "mailerlite.com",                              // MailerLite
        "sendinblue.com", "brevo.com",                 // Brevo
        "getresponse.com",                             // GetResponse
        "aweber.com",                                  // AWeber
        "constantcontact.com",                         // Constant Contact
        "flodesk.com",                                 // Flodesk
      ];
      return platforms.some(p => allHtml.includes(p));
    })();

    // Call-to-action detection (prominent button/link in header or first section)
    const hasCTA = (() => {
      // Check header + first section for buttons/links that look like CTAs
      const headerHtml = ($("header").html() || "").toLowerCase();
      const heroSection = ($("section").first().html() || $("main").children().first().html() || "").toLowerCase();
      const aboveFold = headerHtml + " " + heroSection;

      // CTA keywords in buttons or links
      const ctaPatterns = [
        "get started", "book now", "schedule", "free quote", "free consultation",
        "get a quote", "contact us", "call now", "request", "sign up",
        "start free", "try free", "get free", "learn more", "shop now",
        "buy now", "order now", "get in touch", "let's talk", "book a call",
      ];
      if (ctaPatterns.some(p => aboveFold.includes(p))) return true;

      // Any button element in the header
      if (/<button|<a[^>]*class[^>]*btn|<a[^>]*class[^>]*button/i.test(headerHtml)) return true;

      return false;
    })();

    // Other retargeting pixels (beyond Facebook)
    const hasRetargeting = (() => {
      // TikTok Pixel
      if (allHtml.includes("analytics.tiktok.com") || /ttq\.load/i.test(allHtml)) return true;
      // LinkedIn Insight Tag
      if (allHtml.includes("snap.licdn.com") || allHtml.includes("linkedin.com/insight") || /_linkedin_partner_id/i.test(allHtml)) return true;
      // Twitter/X Pixel
      if (allHtml.includes("static.ads-twitter.com") || /twq\s*\(/i.test(allHtml)) return true;
      // Pinterest Tag
      if (allHtml.includes("s.pinimg.com/ct") || /pintrk\s*\(/i.test(allHtml)) return true;
      // Snapchat Pixel
      if (allHtml.includes("sc-static.net/scevent") || /snaptr\s*\(/i.test(allHtml)) return true;
      // Microsoft/Bing UET
      if (allHtml.includes("bat.bing.com") || /uetq/i.test(allHtml)) return true;
      // Already has Facebook Pixel (counted separately but relevant)
      return false;
    })();

    // ===== LANGUAGE DETECTION =====
    // Detect the dominant language from the visible page text
    const detectedLanguage = await detectLanguage(allPageText);

    // ===== DEEP SEO ANALYSIS =====
    // Pure parsing of the pages we already have — no extra requests.
    const onPage = analyzeOnPageSeo(crawledPages, finalUrl, phones);

    // Three cheap network checks (robots.txt, sitemap, http:// probe) run together.
    // Each resolves to a safe default on failure so one slow host can't fail enrichment.
    const origin = `${baseUrl.protocol}//${baseUrl.host}`;
    const robots = await analyzeRobotsTxt(origin);
    const [sitemap, redirectsToHttps] = await Promise.all([
      analyzeSitemap(origin, robots.sitemapUrls),
      checkHttpsRedirect(baseUrl.hostname),
    ]);

    // Capped link-health sweep. Skipped entirely for parked domains — there's nothing
    // meaningful to check and it would just burn requests.
    const linkHealth = isParkedDomain
      ? { internalLinkCount: 0, checkedLinkCount: 0, brokenInternalLinks: [], redirectingInternalLinks: [] }
      : await checkInternalLinks(crawledPages, baseUrl, [...fetchedUrls], MAX_LINK_CHECKS);

    // ===== DEEP MARKETING ANALYSIS =====
    const tech = detectMarketingTech(allHtml);
    const formFriction = analyzeFormFriction(crawledPages);
    const cta = analyzeCta($, finalUrl);
    const leadMagnet = detectLeadMagnet(allPageText, allHtml);
    const popup = detectConversionPopup(crawledPages, tech);
    const social = analyzeSocialQuality(socialLinks);
    const conversionPath = await analyzeConversionPath(cta, crawledPages, baseUrl.hostname);

    return {
      title: title.slice(0, 200),
      description: description.slice(0, 500),
      headings,
      hasOnlineBooking,
      hasContactForm,
      socialLinks,
      technologies,
      industry,
      emails,
      phones,
      // New signals
      isMobileFriendly,
      hasSSL,
      hasMetaDescription,
      pageLoadTimeMs,
      pageSizeKB,
      copyrightYear,
      isSPA,
      isParkedDomain,
      hasGoogleAds,
      hasFacebookPixel,
      hasAnalytics,
      hasLeadCaptureForm,
      hasOpenGraph,
      hasSchemaMarkup,
      hasEmailMarketing,
      hasCTA,
      hasRetargeting,
      detectedLanguage,

      // ===== SEO =====
      hasRobotsTxt: robots.hasRobotsTxt,
      robotsBlocksSite: robots.robotsBlocksSite,
      robotsSitemapDeclared: robots.robotsSitemapDeclared,
      robotsBlockedPaths: robots.robotsBlockedPaths,
      hasSitemap: sitemap.hasSitemap,
      sitemapUrl: sitemap.sitemapUrl,
      sitemapUrlCount: sitemap.sitemapUrlCount,
      isSitemapIndex: sitemap.isSitemapIndex,
      redirectsToHttps,
      internalLinkCount: linkHealth.internalLinkCount,
      checkedLinkCount: linkHealth.checkedLinkCount,
      brokenInternalLinks: linkHealth.brokenInternalLinks,
      redirectingInternalLinks: linkHealth.redirectingInternalLinks,
      titleLength: onPage.titleLength,
      hasTitle: onPage.hasTitle,
      h1Count: onPage.h1Count,
      headingCounts: onPage.headingCounts,
      emptyHeadingCount: onPage.emptyHeadingCount,
      hasHeadingHierarchyIssues: onPage.hasHeadingHierarchyIssues,
      headingIssues: onPage.headingIssues,
      hasCanonical: onPage.hasCanonical,
      canonicalUrl: onPage.canonicalUrl,
      canonicalIssue: onPage.canonicalIssue,
      isIndexable: onPage.isIndexable,
      hasNoindex: onPage.hasNoindex,
      hasNofollow: onPage.hasNofollow,
      noindexSource: onPage.noindexSource,
      imageCount: onPage.imageCount,
      imagesWithAlt: onPage.imagesWithAlt,
      imagesWithoutAlt: onPage.imagesWithoutAlt,
      emptyAltCount: onPage.emptyAltCount,
      altTextCoverage: onPage.altTextCoverage,
      wordCount: onPage.wordCount,
      isThinContent: onPage.isThinContent,
      pagesAnalyzed: onPage.pagesAnalyzed,
      duplicateTitleCount: onPage.duplicateTitleCount,
      duplicateMetaDescriptionCount: onPage.duplicateMetaDescriptionCount,
      duplicateH1Count: onPage.duplicateH1Count,
      duplicateTitles: onPage.duplicateTitles,
      duplicateH1s: onPage.duplicateH1s,
      schemaTypes: onPage.schemaTypes,
      hasLocalBusinessSchema: onPage.hasLocalBusinessSchema,
      hasHreflang: onPage.hasHreflang,
      hreflangLanguages: onPage.hreflangLanguages,
      hreflangIssues: onPage.hreflangIssues,
      hasBusinessAddress: onPage.hasBusinessAddress,
      hasVisiblePhone: onPage.hasVisiblePhone,
      napConsistency: onPage.napConsistency,

      // ===== MARKETING =====
      marketingTechnologies: tech.marketingTechnologies,
      techByCategory: tech.techByCategory,
      hasClarity: tech.hasClarity,
      hasHotjar: tech.hasHotjar,
      hasMicrosoftUET: tech.hasMicrosoftUET,
      hasHubSpot: tech.hasHubSpot,
      hasTagManager: tech.hasTagManager,
      hasLiveChat: tech.hasLiveChat,
      hasHeatmapTool: tech.hasHeatmapTool,
      formFieldCount: formFriction.formFieldCount,
      requiredFieldCount: formFriction.requiredFieldCount,
      formFriction: formFriction.formFriction,
      formHasPhoneRequired: formFriction.formHasPhoneRequired,
      ctaTexts: cta.ctaTexts,
      primaryCTA: cta.primaryCTA,
      ctaStrength: cta.ctaStrength,
      ctaAboveFold: cta.ctaAboveFold,
      ctaCount: cta.ctaCount,
      competingCtas: cta.competingCtas,
      competingCtaTexts: cta.competingCtaTexts,
      hasLeadMagnet: leadMagnet.hasLeadMagnet,
      leadMagnetType: leadMagnet.leadMagnetType,
      hasConversionPopup: popup.hasConversionPopup,
      popupTechnology: popup.popupTechnology,
      hasClearConversionPath: conversionPath.hasClearConversionPath,
      conversionPathIssues: conversionPath.conversionPathIssues,
      conversionDestinationType: conversionPath.conversionDestinationType,
      socialPlatformCount: social.socialPlatformCount,
      socialPlatforms: social.socialPlatforms,
      socialPresenceStrength: social.socialPresenceStrength,
    };
  } catch (error) {
    logger.error(
      { url: websiteUrl, error: error instanceof Error ? error.message : error },
      "Error scraping website"
    );
    return null;
  }
}

/**
 * Generate enriched data summary based on scraped website
 */
export function generateEnrichmentSummary(websiteData: Partial<WebsiteData> | null, company: string): {
  summary: string;
  issues: string[];
  opportunity: string;
} {
  if (!websiteData) {
    return {
      summary: `${company} has a web presence`,
      issues: ["Unable to fully analyze website"],
      opportunity: "Website appears to need modernization",
    };
  }

  // Parked/dead domain — treat as near-zero digital presence
  if (websiteData.isParkedDomain) {
    return {
      summary: `${company} has a parked/inactive domain — no real website exists`,
      issues: [
        "Domain is parked, for sale, or under construction — no functional website",
        "Zero online presence for customers searching",
        "No way for customers to learn about the business online",
      ],
      opportunity: "Massive opportunity — business has a domain but no website built on it",
    };
  }

  const issues: string[] = [];
  let opportunityScore = 0;

  // --- Critical issues first (visible, verifiable) ---

  // SSL
  if (websiteData.hasSSL === false) {
    issues.push("No SSL certificate — browser shows 'Not Secure' warning to visitors");
    opportunityScore += 3;
  }

  // Mobile
  if (websiteData.isMobileFriendly === false && !websiteData.isSPA) {
    issues.push("Website is not mobile-friendly — broken layout on phones");
    opportunityScore += 3;
  }

  // Slow page
  if (websiteData.pageLoadTimeMs && websiteData.pageLoadTimeMs > 3000) {
    const seconds = (websiteData.pageLoadTimeMs / 1000).toFixed(1);
    issues.push(`Slow page load (${seconds}s) — 53% of visitors leave after 3 seconds`);
    opportunityScore += 2;
  }

  // Large page
  if (websiteData.pageSizeKB && websiteData.pageSizeKB > 500) {
    issues.push(`Heavy page size (${websiteData.pageSizeKB}KB) — slow on mobile data`);
    opportunityScore += 1;
  }

  // Booking
  if (!websiteData.hasOnlineBooking) {
    issues.push("No online booking system");
    opportunityScore += 2;
  }

  // Contact form
  if (!websiteData.hasContactForm) {
    issues.push("Limited contact options — no contact form or live chat");
    opportunityScore += 1;
  }

  // Social
  if (!websiteData.socialLinks || websiteData.socialLinks.length === 0) {
    issues.push("No social media presence found");
    opportunityScore += 1;
  }

  // Meta / SEO
  if (websiteData.hasMetaDescription === false) {
    issues.push("Missing meta description — poor Google search appearance");
    opportunityScore += 1;
  }

  // Outdated copyright
  const currentYear = new Date().getFullYear();
  if (websiteData.copyrightYear && websiteData.copyrightYear < currentYear - 1) {
    issues.push(`Outdated copyright (© ${websiteData.copyrightYear}) — site looks abandoned`);
    opportunityScore += 1;
  }

  // Platform detection
  if (!websiteData.technologies || websiteData.technologies.length === 0) {
    issues.push("No recognizable web platform detected");
    opportunityScore += 1;
  }
  if (websiteData.technologies?.includes("WordPress")) {
    issues.push("Using WordPress (legacy platform — often slow and vulnerable)");
    opportunityScore += 2;
  }

  // SPA caveat
  if (websiteData.isSPA) {
    // Don't flag missing booking/forms/social for SPAs — we might just not see them
    // Already added to data for frontend display
  }

  // Generate summary
  const summary = `${company} (${websiteData.industry}): ${websiteData.title || "Local business"}. ${websiteData.description?.slice(0, 100) || "Business details available."}`;

  // Generate opportunity
  let opportunity = "Improve online visibility and customer engagement";
  if (opportunityScore >= 6) {
    opportunity = "Critical — multiple serious issues driving customers away right now";
  } else if (opportunityScore >= 4) {
    opportunity = "Significant opportunity to modernize digital presence and boost conversions";
  } else if (opportunityScore >= 2) {
    opportunity = "Opportunity to enhance customer experience with modern tools";
  }

  return {
    summary: summary.slice(0, 300),
    issues: issues.slice(0, 8),
    opportunity,
  };
}
