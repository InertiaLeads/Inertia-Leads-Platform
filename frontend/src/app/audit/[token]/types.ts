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
  pageSpeed: { mobile: PageSpeedMetrics | null; desktop: PageSpeedMetrics | null } | null;
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
   * 1–3. Drives ordering within a section and which findings count toward the
   * headline impact estimate. 3 = materially blocking, 1 = polish.
   */
  severity: number;
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

export const WEB_DEV_CATEGORIES = ["Website Health"] as const;
