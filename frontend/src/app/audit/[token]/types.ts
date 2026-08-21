// Shared types for the public audit report.
//
// Every signal is nullable on purpose. A lead enriched before a given check existed
// carries no data for it, and the report must OMIT that finding rather than render a
// missing signal as a failure. Check builders therefore guard on `!= null` before
// pushing anything.

export interface LighthouseAuditFinding {
  id: string;
  title: string;
  score: number | null;
  displayValue?: string;
}

export interface PageSpeedMetrics {
  performanceScore: number;
  accessibilityScore: number;
  bestPracticesScore: number;
  seoScore: number;
  firstContentfulPaint: number;
  largestContentfulPaint: number;
  totalBlockingTime: number;
  cumulativeLayoutShift: number;
  speedIndex: number;
  seoIssues?: LighthouseAuditFinding[];
  accessibilityIssues?: LighthouseAuditFinding[];
}

export interface AuditSignals {
  // ---- Original signals ----
  hasOnlineBooking: boolean | null;
  hasContactForm: boolean | null;
  hasSSL: boolean | null;
  isMobileFriendly: boolean | null;
  hasMetaDescription: boolean | null;
  pageLoadTimeMs: number | null;
  pageSizeKB: number | null;
  copyrightYear: number | null;
  socialLinks: number;
  technologies: string[];
  isParkedDomain: boolean;
  _siteDown: boolean;
  /**
   * True when the homepage is JS-rendered (React/Vue/Next/Nuxt/Angular, or a body with no
   * text and many scripts). The crawler reads static HTML only, so on these sites the
   * absence of a form, a booking widget or a CTA is OUR blind spot, not their omission —
   * checks that depend on visible page content are withheld rather than failed.
   */
  isSPA: boolean | null;
  pageSpeed: {
    mobile: PageSpeedMetrics | null;
    desktop: PageSpeedMetrics | null;
    /** Lighthouse could not render the page at all (e.g. "NO_FCP" — nothing painted). */
    renderFailure?: string | null;
  } | null;
  hasGoogleAds: boolean | null;
  hasFacebookPixel: boolean | null;
  hasAnalytics: boolean | null;
  googleRating: number | null;
  googleReviewCount: number | null;
  hasLeadCaptureForm: boolean | null;
  hasOpenGraph: boolean | null;
  hasSchemaMarkup: boolean | null;
  hasEmailMarketing: boolean | null;
  hasCTA: boolean | null;
  hasRetargeting: boolean | null;

  // ---- Deep SEO signals ----
  hasRobotsTxt: boolean | null;
  robotsBlocksSite: boolean | null;
  robotsSitemapDeclared: boolean | null;
  robotsBlockedPaths: string[];
  hasSitemap: boolean | null;
  sitemapUrlCount: number | null;
  isSitemapIndex: boolean | null;
  redirectsToHttps: boolean | null;
  internalLinkCount: number | null;
  checkedLinkCount: number | null;
  brokenInternalLinks: string[];
  redirectingInternalLinks: string[];
  titleLength: number | null;
  hasTitle: boolean | null;
  h1Count: number | null;
  headingCounts: { h1: number; h2: number; h3: number; h4: number; h5: number; h6: number } | null;
  emptyHeadingCount: number | null;
  hasHeadingHierarchyIssues: boolean | null;
  headingIssues: string[];
  hasCanonical: boolean | null;
  canonicalIssue: string | null;
  isIndexable: boolean | null;
  hasNoindex: boolean | null;
  hasNofollow: boolean | null;
  noindexSource: string | null;
  imageCount: number | null;
  imagesWithAlt: number | null;
  imagesWithoutAlt: number | null;
  emptyAltCount: number | null;
  altTextCoverage: number | null;
  wordCount: number | null;
  isThinContent: boolean | null;
  pagesAnalyzed: number | null;
  duplicateTitleCount: number | null;
  duplicateMetaDescriptionCount: number | null;
  duplicateH1Count: number | null;
  duplicateTitles: string[];
  duplicateH1s: string[];
  schemaTypes: string[];
  hasLocalBusinessSchema: boolean | null;
  hasHreflang: boolean | null;
  hreflangLanguages: string[];
  hreflangIssues: string[];
  hasBusinessAddress: boolean | null;
  hasVisiblePhone: boolean | null;
  napConsistency: "strong" | "partial" | "weak" | null;

  // ---- Deep marketing signals ----
  marketingTechnologies: string[] | null;
  techByCategory: Record<string, string[]> | null;
  hasClarity: boolean | null;
  hasHotjar: boolean | null;
  hasMicrosoftUET: boolean | null;
  hasHubSpot: boolean | null;
  hasTagManager: boolean | null;
  hasLiveChat: boolean | null;
  hasHeatmapTool: boolean | null;
  formFieldCount: number | null;
  requiredFieldCount: number | null;
  formFriction: "low" | "medium" | "high" | null;
  formHasPhoneRequired: boolean | null;
  ctaTexts: string[];
  primaryCTA: string | null;
  ctaStrength: "strong" | "medium" | "weak" | null;
  ctaAboveFold: boolean | null;
  ctaCount: number | null;
  competingCtas: boolean | null;
  competingCtaTexts: string[];
  hasLeadMagnet: boolean | null;
  leadMagnetType: string | null;
  hasConversionPopup: boolean | null;
  popupTechnology: string | null;
  hasClearConversionPath: boolean | null;
  conversionPathIssues: string[];
  conversionDestinationType: "form" | "booking" | "phone" | "email" | "none" | null;
  socialPlatformCount: number | null;
  socialPlatforms: string[];
  socialPresenceStrength: "strong" | "moderate" | "weak" | null;
}

export interface AuditData {
  company: string;
  website: string;
  industry: string;
  score: number;
  benchmark?: {
    avgHealth: number;
    sampleCount: number;
    scope: "industry" | "all";
    label: string;
  } | null;
  serviceType: string;
  language: string;
  summary: string | null;
  issues: string[];
  opportunity: string | null;
  signals: AuditSignals;
  /**
   * True while a Lighthouse run for this lead is still in flight on the server.
   *
   * The two Lighthouse runs take 30–90s and are no longer awaited inside any request, so a
   * freshly generated report is routinely served before Google's numbers exist. The page polls
   * while this is set rather than rendering a permanently gauge-less report.
   */
  pageSpeedPending?: boolean;
  /**
   * Real comparison against the other businesses in the SAME niche and the SAME city, using
   * Google's own review counts and ratings. Unlike the benchmark this replaces, every figure
   * here is a published Google number the reader can verify by searching their own trade in
   * their own town — and the peers are their actual competitors, not a national average.
   */
  localMarket?: {
    niche: string;
    location: string;
    peerCount: number;
    avgReviews: number;
    avgRating: number | null;
    topReviews: number;
    /** How many peers have MORE reviews than this business. */
    aheadOfYou: number;
  } | null;
}

/**
 * Three-state finding status.
 *
 * `warning` exists so a deliberate, legitimate configuration (an intentional noindex,
 * a partially-restricted robots.txt) can be surfaced without being branded a failure —
 * the report has to stay credible to a business owner who knows their own site.
 */
export type CheckStatus = "good" | "warning" | "opportunity";

export interface Check {
  /** Finding name. */
  label: string;
  status: CheckStatus;
  /** Section this finding belongs to, used to group the report. */
  category: string;
  icon: string;
  /** "Detected" — what we actually observed. */
  detail: string;
  /** "Why it matters" — short practical explanation. Empty for passing checks. */
  impact: string;
  /** "Opportunity" — the specific improvement to consider. Empty for passing checks. */
  fix: string;
  /**
   * 1–4. Drives ordering within a section, the priority tiles, and this check's weight in
   * the score. 4 = costs the business enquiries directly (no way to book, no way to get in
   * touch, invisible to Google, site not usable on a phone). 3 = materially blocking.
   * 2 = worth fixing. 1 = polish and technical hygiene.
   */
  severity: number;
  /**
   * Optional 0–1 quality ratio for a check measuring something CONTINUOUS — alt-text
   * coverage, content depth, review count, load time.
   *
   * Without it a check is all-or-nothing, so 34% alt-text coverage scored exactly the same
   * as 0%, and a site squeaking over a threshold banked full marks. Both directions
   * flattered the site and made the headline score cluster at the top. When set, the score
   * uses this fraction of the check's weight; `status` still decides the colour and copy.
   */
  ratio?: number;
  /**
   * Set on checks whose measurement is ALREADY a component of the composite score in its
   * own right (the Lighthouse performance checks). Without this they'd be counted twice.
   */
  excludeFromScore?: boolean;
}

export const isPassing = (c: Check): boolean => c.status === "good";

/** Section order for each service type — controls how findings are laid out. */
export const SEO_CATEGORIES = [
  "Technical SEO",
  "On-Page SEO",
  "Structured Data",
  "Local SEO Readiness",
  "Performance",
] as const;

export const MARKETING_CATEGORIES = [
  "Measurement",
  "Acquisition",
  "Conversion",
  "Retention & Nurturing",
] as const;

export const WEB_DEV_CATEGORIES = [
  "Security & Trust",
  "Mobile & Performance",
  "Turning Visitors Into Customers",
  "Build Quality",
] as const;
