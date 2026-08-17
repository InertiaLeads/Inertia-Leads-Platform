import * as cheerio from "cheerio";
import { URL } from "url";
import { safeGet, safeProbe, isSameSite } from "./httpClient";

// =============================================
// SEO analysis
// =============================================
// Everything here is derived from pages the scraper ALREADY downloads, plus three
// cheap extra fetches (robots.txt, sitemap.xml, an http:// probe) and a small,
// hard-capped batch of link status checks.
//
// Accuracy principle throughout: absence of evidence is reported as "not detected",
// never as "does not exist". A check that could not be performed returns null so the
// audit report can omit it entirely rather than guess.

export interface CrawledPage {
  url: string;
  $: cheerio.CheerioAPI;
  /** Response headers, used for the X-Robots-Tag indexability check. */
  headers?: Record<string, any>;
}

// ---------------------------------------------------------------------------
// 1. robots.txt
// ---------------------------------------------------------------------------

export interface RobotsResult {
  hasRobotsTxt: boolean;
  robotsBlocksSite: boolean;
  robotsSitemapDeclared: boolean;
  robotsBlockedPaths: string[];
  sitemapUrls: string[];
}

// Paths that are SUPPOSED to be disallowed. Flagging these as a problem would be
// wrong — blocking an admin panel or a cart from crawlers is correct practice.
const EXPECTED_DISALLOW = [
  "/wp-admin", "/wp-includes", "/wp-json", "/admin", "/administrator", "/cgi-bin",
  "/cart", "/checkout", "/basket", "/account", "/my-account", "/login", "/logout",
  "/search", "/wp-content/plugins", "/wp-content/cache", "/tmp", "/private",
  "/xmlrpc", "/feed", "/trackback", "/*?", "/*.php$", "/node/add", "/user/",
];

function isExpectedDisallow(path: string): boolean {
  const p = path.toLowerCase();
  return EXPECTED_DISALLOW.some((e) => p.startsWith(e) || p.includes(e));
}

/**
 * Fetch and parse /robots.txt.
 *
 * `robotsBlocksSite` is only set when the wildcard group disallows the whole site AND
 * does not re-allow it — a full block is a serious, genuinely reportable finding, so it
 * must not fire on an `Allow: /` override.
 */
export async function analyzeRobotsTxt(origin: string): Promise<RobotsResult> {
  const empty: RobotsResult = {
    hasRobotsTxt: false,
    robotsBlocksSite: false,
    robotsSitemapDeclared: false,
    robotsBlockedPaths: [],
    sitemapUrls: [],
  };

  const res = await safeGet(`${origin}/robots.txt`, { timeout: 7000, maxBytes: 512 * 1024 });
  if (!res || res.status !== 200) return empty;

  // Guard against soft-404s: plenty of servers return the HTML site for a missing
  // robots.txt with a 200 status. A real robots.txt is plain text with directives.
  const body = res.data || "";
  if (/<html|<!doctype html/i.test(body.slice(0, 500))) return empty;
  if (!/^\s*(user-agent|sitemap|disallow|allow)\s*:/im.test(body)) return empty;

  const sitemapUrls: string[] = [];
  const blockedPaths: string[] = [];
  let blocksSite = false;
  let wildcardAllowsRoot = false;

  let currentAgents: string[] = [];
  let previousLineWasAgent = false;

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.split("#")[0].trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === "user-agent") {
      // Consecutive user-agent lines form ONE group sharing the rules below them.
      if (!previousLineWasAgent) currentAgents = [];
      currentAgents.push(value.toLowerCase());
      previousLineWasAgent = true;
      continue;
    }
    previousLineWasAgent = false;

    // Sitemap declarations are global — not scoped to a user-agent group.
    if (field === "sitemap" && value) {
      sitemapUrls.push(value);
      continue;
    }

    const appliesToAll = currentAgents.includes("*");
    if (!appliesToAll) continue;

    if (field === "disallow") {
      if (value === "/") blocksSite = true;
      else if (value && !isExpectedDisallow(value)) blockedPaths.push(value);
    } else if (field === "allow" && value === "/") {
      wildcardAllowsRoot = true;
    }
  }

  return {
    hasRobotsTxt: true,
    robotsBlocksSite: blocksSite && !wildcardAllowsRoot,
    robotsSitemapDeclared: sitemapUrls.length > 0,
    robotsBlockedPaths: [...new Set(blockedPaths)].slice(0, 8),
    sitemapUrls: [...new Set(sitemapUrls)].slice(0, 5),
  };
}

// ---------------------------------------------------------------------------
// 2. XML sitemap
// ---------------------------------------------------------------------------

export interface SitemapResult {
  hasSitemap: boolean;
  sitemapUrl: string | null;
  sitemapUrlCount: number;
  isSitemapIndex: boolean;
}

function countLocs(xml: string): number {
  const matches = xml.match(/<loc\b[^>]*>/gi);
  return matches ? matches.length : 0;
}

function firstLoc(xml: string): string | null {
  const m = xml.match(/<loc\b[^>]*>\s*([^<\s]+)\s*<\/loc>/i);
  return m ? m[1].trim() : null;
}

/**
 * Locate an XML sitemap. Checks robots.txt declarations first (authoritative), then
 * the two conventional locations. Requires a real XML root element so a soft-404 HTML
 * page served at /sitemap.xml isn't counted as a sitemap.
 */
export async function analyzeSitemap(origin: string, declaredUrls: string[] = []): Promise<SitemapResult> {
  const empty: SitemapResult = { hasSitemap: false, sitemapUrl: null, sitemapUrlCount: 0, isSitemapIndex: false };

  const candidates = [
    ...declaredUrls,
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
  ].filter((u, i, arr) => u && arr.indexOf(u) === i).slice(0, 4);

  for (const candidate of candidates) {
    const res = await safeGet(candidate, { timeout: 8000, maxBytes: 3 * 1024 * 1024 });
    if (!res || res.status !== 200) continue;
    const xml = res.data || "";
    const isIndex = /<sitemapindex[\s>]/i.test(xml);
    const isUrlSet = /<urlset[\s>]/i.test(xml);
    if (!isIndex && !isUrlSet) continue;

    let urlCount = countLocs(xml);

    // A sitemap index lists child sitemaps, not pages. Follow the first child once so
    // the reported count means "pages listed" rather than "sitemaps listed".
    if (isIndex) {
      const child = firstLoc(xml);
      if (child) {
        const childRes = await safeGet(child, { timeout: 8000, maxBytes: 3 * 1024 * 1024 });
        if (childRes && childRes.status === 200 && /<urlset[\s>]/i.test(childRes.data || "")) {
          urlCount = countLocs(childRes.data);
        }
      }
    }

    return { hasSitemap: true, sitemapUrl: candidate, sitemapUrlCount: urlCount, isSitemapIndex: isIndex };
  }

  return empty;
}

// ---------------------------------------------------------------------------
// 3. HTTP → HTTPS redirect
// ---------------------------------------------------------------------------

/**
 * Does plain http:// traffic end up on https://?
 *
 * Distinct from `hasSSL`: a site can serve HTTPS perfectly well while still answering
 * on HTTP, which leaves visitors and link equity on the insecure version.
 *
 * Walks the redirect chain one hop at a time rather than letting the client follow it.
 * Two reasons: we only need response headers (following the chain would download a full
 * homepage just to read its final URL, and large pages then trip the size cap), and
 * `http → http://www → https://www` is a common and perfectly valid chain that a
 * single-hop check would misreport as "no HTTPS redirect".
 *
 * Returns null when the HTTP endpoint couldn't be reached at all — that's "unknown",
 * not "misconfigured", and the report omits the check.
 */
export async function checkHttpsRedirect(hostname: string): Promise<boolean | null> {
  let current = `http://${hostname}/`;

  for (let hop = 0; hop < 4; hop++) {
    const res = await safeProbe(current, 8000);
    if (!res) return null;                          // unreachable — unknown, not a failure
    if (res.status < 300 || res.status >= 400) {
      // Terminal response on this URL. Secure only if we already moved to https.
      return current.startsWith("https://");
    }
    if (!res.location) return false;                // redirect with no target to follow
    try {
      const next = new URL(res.location, current).toString();
      if (next === current) return current.startsWith("https://"); // self-redirect loop
      current = next;
    } catch {
      return null;
    }
    if (current.startsWith("https://")) return true;
  }

  return current.startsWith("https://");
}

// ---------------------------------------------------------------------------
// 4. Internal link health
// ---------------------------------------------------------------------------

export interface LinkHealthResult {
  internalLinkCount: number;
  checkedLinkCount: number;
  brokenInternalLinks: string[];
  redirectingInternalLinks: string[];
}

// Two URLs that differ only by scheme, www, trailing slash or case are not a
// "redirect problem" worth reporting — that's routine canonicalisation.
function isTrivialRedirect(from: string, to: string): boolean {
  const norm = (u: string) =>
    u.toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/+$/, "")
      .replace(/[?#].*$/, "");
  try {
    return norm(from) === norm(new URL(to, from).toString());
  } catch {
    return false;
  }
}

/**
 * Probe a hard-capped sample of same-domain links for dead ends.
 *
 * Deliberately conservative: a link that times out or refuses connection is NOT
 * reported as broken (transient failures and bot-blocking are common). Only an
 * explicit 4xx/5xx from the server counts.
 */
export async function checkInternalLinks(
  pages: CrawledPage[],
  baseUrl: URL,
  alreadyFetched: string[],
  maxToCheck = 20
): Promise<LinkHealthResult> {
  const links = new Set<string>();

  for (const page of pages) {
    page.$("a[href]").each((_i: number, el: any) => {
      const href = page.$(el).attr("href");
      if (!href) return;
      const trimmed = href.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      if (/^(mailto|tel|javascript|sms|whatsapp|data):/i.test(trimmed)) return;
      try {
        const resolved = new URL(trimmed, page.url);
        if (!isSameSite(resolved.hostname, baseUrl.hostname)) return;
        if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return;
        resolved.hash = "";
        // Skip asset links — a 404 on a stylesheet is a different conversation.
        if (/\.(png|jpe?g|gif|svg|webp|ico|css|js|woff2?|ttf|mp4|zip)$/i.test(resolved.pathname)) return;
        links.add(resolved.toString());
      } catch { /* ignore malformed href */ }
    });
  }

  const internalLinkCount = links.size;

  const fetchedSet = new Set(alreadyFetched.map((u) => u.replace(/\/+$/, "")));
  const toCheck = [...links]
    .filter((u) => !fetchedSet.has(u.replace(/\/+$/, "")))
    .slice(0, maxToCheck);

  const broken: string[] = [];
  const redirecting: string[] = [];

  const CONCURRENCY = 5;
  for (let i = 0; i < toCheck.length; i += CONCURRENCY) {
    const batch = toCheck.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (url) => {
        const result = await safeProbe(url);
        if (!result) return; // unreachable/timeout — not claimed as broken
        if (result.status >= 400) {
          broken.push(url);
        } else if (result.status >= 300 && result.status < 400 && result.location) {
          if (!isTrivialRedirect(url, result.location)) redirecting.push(url);
        }
      })
    );
  }

  return {
    internalLinkCount,
    checkedLinkCount: toCheck.length,
    brokenInternalLinks: broken.slice(0, 10),
    redirectingInternalLinks: redirecting.slice(0, 10),
  };
}

// ---------------------------------------------------------------------------
// 5. On-page SEO (pure parsing — no network)
// ---------------------------------------------------------------------------

export interface OnPageSeoResult {
  // Title
  title: string;
  titleLength: number;
  hasTitle: boolean;
  // Headings
  h1Count: number;
  headingCounts: { h1: number; h2: number; h3: number; h4: number; h5: number; h6: number };
  emptyHeadingCount: number;
  hasHeadingHierarchyIssues: boolean;
  headingIssues: string[];
  // Canonical
  hasCanonical: boolean;
  canonicalUrl: string | null;
  canonicalIssue: string | null;
  // Indexability
  isIndexable: boolean;
  hasNoindex: boolean;
  hasNofollow: boolean;
  noindexSource: string | null;
  // Images
  imageCount: number;
  imagesWithAlt: number;
  imagesWithoutAlt: number;
  /**
   * Images carrying alt="" specifically. Separated from "no alt attribute at all"
   * because an empty alt is the CORRECT markup for a decorative image — conflating the
   * two would report deliberate, valid markup as a defect.
   */
  emptyAltCount: number;
  altTextCoverage: number;
  // Structured data
  schemaTypes: string[];
  hasLocalBusinessSchema: boolean;
  // Hreflang
  hasHreflang: boolean;
  hreflangLanguages: string[];
  hreflangIssues: string[];
  // Content depth
  wordCount: number;
  isThinContent: boolean;
  // Duplicate metadata across crawled pages
  pagesAnalyzed: number;
  duplicateTitleCount: number;
  duplicateMetaDescriptionCount: number;
  duplicateH1Count: number;
  /** The actual repeated title text, so the report can quote it back. */
  duplicateTitles: string[];
  duplicateH1s: string[];
  // Local / NAP
  hasBusinessAddress: boolean;
  hasVisiblePhone: boolean;
  napConsistency: "strong" | "partial" | "weak";
}

// Schema.org types that establish a business as a local entity. Google treats these
// as the foundation of a local search listing, so their absence is the single most
// actionable structured-data finding for a local business.
const LOCAL_BUSINESS_SCHEMA_TYPES = new Set([
  "localbusiness", "organization", "professionalservice", "store", "restaurant",
  "dentist", "physician", "medicalclinic", "medicalbusiness", "hospital", "pharmacy",
  "lawyer", "legalservice", "attorney", "accountingservice", "financialservice",
  "insuranceagency", "realestateagent", "homeandconstructionbusiness", "plumber",
  "electrician", "roofingcontractor", "generalcontractor", "hvacbusiness",
  "beautysalon", "hairsalon", "daysalon", "spa", "healthandbeautybusiness",
  "automotivebusiness", "autorepair", "veterinarycare", "childcare", "school",
  "gym", "sportsactivitylocation", "lodgingbusiness", "hotel", "travelagency",
  "foodestablishment", "cafeorcoffeeshop", "bakery", "bar", "nightclub",
  "emergencyservice", "movingcompany", "selfstorage", "tattooparlor", "locksmith",
]);

// Recursively pull every @type out of a JSON-LD document, including @graph nodes and
// nested objects (many CMS plugins emit one graph containing everything).
function collectSchemaTypes(node: any, out: Set<string>, depth = 0): void {
  if (!node || depth > 6) return;
  if (Array.isArray(node)) {
    for (const item of node) collectSchemaTypes(item, out, depth + 1);
    return;
  }
  if (typeof node !== "object") return;

  const type = node["@type"];
  if (typeof type === "string") out.add(type);
  else if (Array.isArray(type)) for (const t of type) if (typeof t === "string") out.add(t);

  if (node["@graph"]) collectSchemaTypes(node["@graph"], out, depth + 1);
  for (const key of Object.keys(node)) {
    if (key === "@type" || key === "@graph") continue;
    const value = node[key];
    if (value && typeof value === "object") collectSchemaTypes(value, out, depth + 1);
  }
}

// Visible text with script/style/nav chrome removed, used for word count and
// address detection.
function visibleText($: cheerio.CheerioAPI): string {
  const body = $("body").clone();
  body.find("script, style, noscript, svg, code, iframe").remove();
  return body.text().replace(/\s+/g, " ").trim();
}

// A "meaningful" word: at least two characters and containing a letter. Filters out
// standalone digits, bullets and punctuation so the count reflects real copy.
function countMeaningfulWords(text: string): number {
  return text
    .split(/\s+/)
    .filter((w) => w.length >= 2 && /[a-zA-ZÀ-ɏЀ-ӿ]/.test(w)).length;
}

// Street-address heuristics. Deliberately broad across common EU/US formats, and
// paired with schema/`<address>` evidence so a single weak regex hit isn't decisive.
const ADDRESS_PATTERNS: RegExp[] = [
  /\b\d{1,5}\s+[A-Za-z0-9.\-']+\s+(street|st|road|rd|avenue|ave|boulevard|blvd|lane|ln|drive|dr|court|ct|way|place|pl|parkway|pkwy|highway|hwy|suite|ste|unit)\b/i,
  /\b(calle|carrer|avenida|avda|rua|via|viale|strasse|straße|str\.|weg|laan|straat|rue|boulevard|plaza|placa)\s+[A-Za-z0-9.\-']+/i,
  /\b\d{5}(-\d{4})?\s+[A-Z][a-z]+/,                    // US ZIP + city
  /\b[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}\b/,          // UK postcode
  /\b\d{4,5}\s+[A-Z][a-zA-Zäöüéèàç\-]{2,}\b/,          // EU postcode + city
];

export function analyzeOnPageSeo(
  pages: CrawledPage[],
  siteUrl: string,
  knownPhones: string[] = []
): OnPageSeoResult {
  const home = pages[0];
  const $ = home.$;

  // ---- Title ----
  const title = ($("title").first().text() || "").trim();
  const hasTitle = title.length > 0;

  // ---- Headings (homepage) ----
  const headingCounts = {
    h1: $("h1").length, h2: $("h2").length, h3: $("h3").length,
    h4: $("h4").length, h5: $("h5").length, h6: $("h6").length,
  };
  let emptyHeadingCount = 0;
  $("h1, h2, h3, h4, h5, h6").each((_i: number, el: any) => {
    if (!$(el).text().trim()) emptyHeadingCount++;
  });

  const headingIssues: string[] = [];
  if (headingCounts.h1 === 0) headingIssues.push("No H1 heading found on the homepage");
  else if (headingCounts.h1 > 1) headingIssues.push(`${headingCounts.h1} H1 headings found on one page`);
  if (emptyHeadingCount > 0) headingIssues.push(`${emptyHeadingCount} empty heading element${emptyHeadingCount === 1 ? "" : "s"}`);

  // Hierarchy: walk headings in document order and flag a jump of more than one level
  // (e.g. H1 straight to H4), which breaks the document outline.
  const levelSequence: number[] = [];
  $("h1, h2, h3, h4, h5, h6").each((_i: number, el: any) => {
    const tag = (el.tagName || el.name || "").toLowerCase();
    const level = parseInt(tag.replace("h", ""), 10);
    if (level >= 1 && level <= 6) levelSequence.push(level);
  });
  let skippedLevel = false;
  for (let i = 1; i < levelSequence.length; i++) {
    if (levelSequence[i] - levelSequence[i - 1] > 1) { skippedLevel = true; break; }
  }
  if (skippedLevel) headingIssues.push("Heading levels skip a step (for example H1 followed by H3 or H4)");
  if (levelSequence.length <= 1) headingIssues.push("Almost no heading structure detected");

  // ---- Canonical ----
  const canonicalRaw = ($('link[rel="canonical"]').first().attr("href") || "").trim();
  const hasCanonical = canonicalRaw.length > 0;
  let canonicalUrl: string | null = null;
  let canonicalIssue: string | null = null;
  if (hasCanonical) {
    try {
      const resolved = new URL(canonicalRaw, home.url);
      canonicalUrl = resolved.toString();
      const siteHost = new URL(siteUrl).hostname.replace(/^www\./, "");
      const canonicalHost = resolved.hostname.replace(/^www\./, "");
      if (canonicalHost !== siteHost) {
        canonicalIssue = `Canonical tag points to a different domain (${resolved.hostname})`;
      }
    } catch {
      canonicalIssue = "Canonical tag contains an invalid URL";
      canonicalUrl = canonicalRaw;
    }
  }

  // ---- Indexability ----
  const robotsMeta = ($('meta[name="robots"]').attr("content") || "").toLowerCase();
  const googlebotMeta = ($('meta[name="googlebot"]').attr("content") || "").toLowerCase();
  const xRobotsTag = String(home.headers?.["x-robots-tag"] || "").toLowerCase();
  const combinedDirectives = `${robotsMeta} ${googlebotMeta} ${xRobotsTag}`;

  const hasNoindex = /\bnoindex\b|\bnone\b/.test(combinedDirectives);
  const hasNofollow = /\bnofollow\b|\bnone\b/.test(combinedDirectives);
  let noindexSource: string | null = null;
  if (hasNoindex) {
    if (/\bnoindex\b|\bnone\b/.test(xRobotsTag)) noindexSource = "X-Robots-Tag HTTP header";
    else if (/\bnoindex\b|\bnone\b/.test(robotsMeta)) noindexSource = "robots meta tag";
    else noindexSource = "googlebot meta tag";
  }

  // ---- Images ----
  let imageCount = 0;
  let imagesWithAlt = 0;
  let emptyAltCount = 0;
  for (const page of pages) {
    page.$("img").each((_i: number, el: any) => {
      imageCount++;
      const alt = page.$(el).attr("alt");
      // A present-but-empty alt is valid for decorative images, but it carries no
      // descriptive value — counted as "without" for coverage purposes, and tracked
      // separately so the report can tell deliberate markup apart from an omission.
      if (typeof alt === "string" && alt.trim().length > 0) imagesWithAlt++;
      else if (typeof alt === "string") emptyAltCount++;
    });
  }
  const imagesWithoutAlt = imageCount - imagesWithAlt;
  const altTextCoverage = imageCount > 0 ? Math.round((imagesWithAlt / imageCount) * 100) : 100;

  // ---- Structured data types ----
  const schemaTypeSet = new Set<string>();
  for (const page of pages) {
    page.$('script[type="application/ld+json"]').each((_i: number, el: any) => {
      const raw = page.$(el).contents().text() || page.$(el).html() || "";
      if (!raw.trim()) return;
      try {
        collectSchemaTypes(JSON.parse(raw), schemaTypeSet);
      } catch {
        // Malformed JSON-LD is common. Fall back to a regex sweep so we still learn
        // which types the site intended to declare.
        const matches = raw.match(/"@type"\s*:\s*"([^"]+)"/g) || [];
        for (const m of matches) {
          const t = m.match(/"@type"\s*:\s*"([^"]+)"/);
          if (t) schemaTypeSet.add(t[1]);
        }
      }
    });
    // Microdata
    page.$("[itemscope][itemtype]").each((_i: number, el: any) => {
      const itemtype = page.$(el).attr("itemtype") || "";
      const name = itemtype.split("/").pop();
      if (name) schemaTypeSet.add(name);
    });
  }
  const schemaTypes = [...schemaTypeSet]
    .map((t) => t.replace(/^https?:\/\/schema\.org\//i, "").trim())
    .filter(Boolean)
    .slice(0, 20);
  const hasLocalBusinessSchema = schemaTypes.some((t) => LOCAL_BUSINESS_SCHEMA_TYPES.has(t.toLowerCase()));

  // ---- Hreflang ----
  const hreflangLanguages: string[] = [];
  const hreflangIssues: string[] = [];
  const seenHreflang = new Set<string>();
  $('link[rel="alternate"][hreflang]').each((_i: number, el: any) => {
    const code = ($(el).attr("hreflang") || "").trim();
    if (!code) return;
    const lower = code.toLowerCase();
    if (seenHreflang.has(lower)) {
      if (!hreflangIssues.includes("Duplicate hreflang declarations found")) {
        hreflangIssues.push("Duplicate hreflang declarations found");
      }
    } else {
      seenHreflang.add(lower);
      hreflangLanguages.push(code);
    }
    // Valid forms: "x-default", "en", "en-GB".
    if (lower !== "x-default" && !/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/.test(lower)) {
      hreflangIssues.push(`Malformed hreflang value: "${code}"`);
    }
  });

  // ---- Content depth ----
  const homeText = visibleText($);
  const wordCount = countMeaningfulWords(homeText);
  const isThinContent = wordCount < 200;

  // ---- Duplicate metadata across crawled pages ----
  const titles: string[] = [];
  const descriptions: string[] = [];
  const h1Texts: string[] = [];
  for (const page of pages) {
    const t = (page.$("title").first().text() || "").trim().toLowerCase();
    if (t) titles.push(t);
    const d = (page.$('meta[name="description"]').attr("content") || "").trim().toLowerCase();
    if (d) descriptions.push(d);
    const h = (page.$("h1").first().text() || "").trim().toLowerCase();
    if (h) h1Texts.push(h);
  }
  // Returns how many pages share a value with at least one other page, plus the
  // repeated values themselves so the report can quote them ("3 pages all titled Home").
  const findDuplicates = (values: string[]): { count: number; repeated: string[] } => {
    const seen = new Map<string, number>();
    for (const v of values) seen.set(v, (seen.get(v) || 0) + 1);
    let count = 0;
    const repeated: string[] = [];
    for (const [value, n] of seen) {
      if (n > 1) { count += n; repeated.push(value); }
    }
    return { count, repeated };
  };

  const titleDupes = findDuplicates(titles);
  const descDupes = findDuplicates(descriptions);
  const h1Dupes = findDuplicates(h1Texts);

  // ---- NAP / local signals ----
  const addressFromSchema = schemaTypes.some((t) => t.toLowerCase() === "postaladdress")
    || pages.some((p) => /"address"\s*:/i.test(p.$('script[type="application/ld+json"]').text() || ""));
  const addressTagText = pages.map((p) => p.$("address").text()).join(" ").trim();
  const combinedText = pages.map((p) => visibleText(p.$)).join(" ");
  const addressFromText = ADDRESS_PATTERNS.some((re) => re.test(combinedText));
  const hasBusinessAddress = !!(addressFromSchema || addressTagText.length > 10 || addressFromText);

  const telLinkCount = pages.reduce((sum, p) => sum + p.$('a[href^="tel:"]').length, 0);
  const hasVisiblePhone = telLinkCount > 0 || knownPhones.length > 0;

  // Strong = address + phone + a local-business schema type backing them up.
  let napConsistency: "strong" | "partial" | "weak" = "weak";
  const napSignals = [hasBusinessAddress, hasVisiblePhone, hasLocalBusinessSchema].filter(Boolean).length;
  if (napSignals >= 3) napConsistency = "strong";
  else if (napSignals === 2) napConsistency = "partial";

  return {
    title,
    titleLength: title.length,
    hasTitle,
    h1Count: headingCounts.h1,
    headingCounts,
    emptyHeadingCount,
    hasHeadingHierarchyIssues: headingIssues.length > 0,
    headingIssues,
    hasCanonical,
    canonicalUrl,
    canonicalIssue,
    isIndexable: !hasNoindex,
    hasNoindex,
    hasNofollow,
    noindexSource,
    imageCount,
    imagesWithAlt,
    imagesWithoutAlt,
    emptyAltCount,
    altTextCoverage,
    schemaTypes,
    hasLocalBusinessSchema,
    hasHreflang: hreflangLanguages.length > 0,
    hreflangLanguages: hreflangLanguages.slice(0, 12),
    hreflangIssues: [...new Set(hreflangIssues)].slice(0, 4),
    wordCount,
    isThinContent,
    pagesAnalyzed: pages.length,
    duplicateTitleCount: titleDupes.count,
    duplicateMetaDescriptionCount: descDupes.count,
    duplicateH1Count: h1Dupes.count,
    duplicateTitles: titleDupes.repeated.slice(0, 3),
    duplicateH1s: h1Dupes.repeated.slice(0, 3),
    hasBusinessAddress,
    hasVisiblePhone,
    napConsistency,
  };
}
