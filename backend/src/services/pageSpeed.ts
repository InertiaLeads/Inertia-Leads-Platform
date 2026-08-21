import axios from "axios";
import logger from "../utils/logger";
import { mergeEnrichedData } from "./enrichedData";

/**
 * A single failed Lighthouse audit, carried through to the report.
 *
 * We already pay for the full Lighthouse run to get the five headline numbers, and the
 * response contains Google's own per-check verdict on titles, meta descriptions, alt
 * text, crawlability, hreflang, canonical tags, contrast and tap targets. Keeping those
 * costs nothing extra and is far more credible in a prospect-facing report than our own
 * regex conclusions.
 */
export interface LighthouseAuditFinding {
  id: string;
  title: string;
  score: number | null;
  displayValue?: string;
}

export interface PageSpeedMetrics {
  performanceScore: number;       // 0-100
  accessibilityScore: number;     // 0-100
  bestPracticesScore: number;     // 0-100
  seoScore: number;               // 0-100
  firstContentfulPaint: number;   // ms
  largestContentfulPaint: number; // ms
  totalBlockingTime: number;      // ms
  cumulativeLayoutShift: number;  // score (0-1)
  speedIndex: number;             // ms
  // Failed sub-audits from the same response (no extra API call)
  seoIssues?: LighthouseAuditFinding[];
  accessibilityIssues?: LighthouseAuditFinding[];
}

export interface PageSpeedResult {
  mobile: PageSpeedMetrics | null;
  desktop: PageSpeedMetrics | null;
  /**
   * Set when Lighthouse could not render the page on EITHER strategy — e.g. "NO_FCP" (the
   * page painted no content). Reported to the prospect as a finding; absent means we simply
   * have no performance data, which is never presented as a fault.
   */
  renderFailure?: string | null;
}

const API_KEY = process.env.PAGESPEED_API_KEY || "";
const API_URL = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

// 90s, not 45s. We ask for FOUR Lighthouse categories in one run, which is far heavier than
// the single-category runs most examples use — a measured single-category call already takes
// ~26s, and four categories on a slow site regularly exceeds 45s. Enrichment also runs 5 leads
// at a time, so our own concurrency was pushing these over the edge and every timeout meant a
// report with no performance data at all.
const TIMEOUT = 90000;

// Lighthouse runs are expensive at Google's end and slow down under load, so how many run at
// once is capped process-wide.
//
// There are TWO pools, deliberately, because the two callers compete for very different work:
//
//  * REPORT runs (`getPageSpeedScores`) are the numbers the prospect sees. Four categories,
//    two strategies, 13–90s each.
//  * REACHABILITY probes (`canGoogleReachSite`) are a one-category sanity check the crawler
//    fires for every site it cannot open itself.
//
// They shared a single 2-slot pool. Enriching 49 leads five at a time means a burst of
// reachability probes that occupied both slots for minutes on end, so every report Lighthouse
// run queued behind them and hit its own timeout waiting for a slot. Separate pools mean a
// crawl can never starve the report data.
function makeGate(limit: number) {
  let inFlight = 0;
  const waiting: (() => void)[] = [];
  return {
    async acquire(): Promise<void> {
      if (inFlight < limit) {
        inFlight++;
        return;
      }
      await new Promise<void>((resolve) => waiting.push(resolve));
      inFlight++;
    },
    release(): void {
      inFlight--;
      const next = waiting.shift();
      if (next) next();
    },
  };
}

// 4, not 2. Google's per-key ceiling is 240 requests/minute; at ~20s a run, four in flight is
// ~12 requests/minute — nowhere near the limit, and it stops a handful of concurrent report
// views from queueing into their own timeouts.
const reportGate = makeGate(4);
const probeGate = makeGate(2);

/**
 * Lighthouse document-level failures, as opposed to "the API was slow".
 *
 * These mean Google's own browser could not render the page at all — no content painted, or
 * the document request failed outright. That is a finding about the site, not a gap in our
 * data, so it is carried through to the report rather than silently discarded.
 */
const DOCUMENT_FAILURES = ["NO_FCP", "ERRORED_DOCUMENT_REQUEST", "FAILED_DOCUMENT_REQUEST", "NOT_HTML"];

function extractLighthouseError(error: any): string | null {
  const message: string = error?.response?.data?.error?.message || "";
  if (!message) return null;
  const found = DOCUMENT_FAILURES.find((code) => message.includes(code));
  return found ?? null;
}

/** Why a single attempt produced no metrics. */
type FetchFailure = "timeout" | "document" | "other";

/**
 * Single attempt to fetch Lighthouse metrics for a URL + strategy.
 *
 * Returns the failure KIND as well as the metrics, because the two failure kinds need
 * opposite handling: a timeout is worth retrying, while a document-level Lighthouse error
 * (the page painted nothing) is deterministic and is itself a finding about the site.
 */
async function fetchScore(
  url: string,
  strategy: "mobile" | "desktop"
): Promise<{ metrics: PageSpeedMetrics | null; failure: FetchFailure | null; code?: string }> {
  try {
    const response = await axios.get(API_URL, {
      params: {
        url,
        strategy,
        key: API_KEY,
        category: ["performance", "accessibility", "best-practices", "seo"],
      },
      timeout: TIMEOUT,
      paramsSerializer: (p) => {
        const parts: string[] = [];
        for (const [key, val] of Object.entries(p)) {
          if (Array.isArray(val)) {
            for (const v of val) parts.push(`${key}=${encodeURIComponent(v)}`);
          } else {
            parts.push(`${key}=${encodeURIComponent(val as string)}`);
          }
        }
        return parts.join("&");
      },
    });

    const lighthouse = response.data?.lighthouseResult;
    if (!lighthouse) return { metrics: null, failure: "other" };

    const cats = lighthouse.categories || {};
    const perfScore = cats.performance?.score;
    if (perfScore === undefined || perfScore === null) return { metrics: null, failure: "other" };

    const audits = lighthouse.audits || {};

    // Pull the FAILED audits out of a category, ordered by Lighthouse's own weighting so
    // the most consequential issue leads. `auditRefs` is used rather than a hard-coded id
    // list so this keeps working as Google adds or renames checks.
    const failedAuditsFor = (categoryKey: string): LighthouseAuditFinding[] => {
      const refs = cats[categoryKey]?.auditRefs;
      if (!Array.isArray(refs)) return [];
      const failures: (LighthouseAuditFinding & { weight: number })[] = [];
      for (const ref of refs) {
        const audit = audits[ref?.id];
        if (!audit) continue;
        // score === null means "informative" or "not applicable" — not a failure.
        if (typeof audit.score !== "number" || audit.score >= 1) continue;
        failures.push({
          id: String(ref.id),
          title: String(audit.title || ref.id),
          score: audit.score,
          ...(audit.displayValue ? { displayValue: String(audit.displayValue) } : {}),
          weight: typeof ref.weight === "number" ? ref.weight : 0,
        });
      }
      return failures
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 10)
        .map(({ weight, ...rest }) => rest);
    };

    const metrics: PageSpeedMetrics = {
      seoIssues: failedAuditsFor("seo"),
      accessibilityIssues: failedAuditsFor("accessibility"),
      performanceScore: Math.round(perfScore * 100),
      accessibilityScore: Math.round((cats.accessibility?.score ?? 0) * 100),
      bestPracticesScore: Math.round((cats["best-practices"]?.score ?? 0) * 100),
      seoScore: Math.round((cats.seo?.score ?? 0) * 100),
      firstContentfulPaint: Math.round(audits["first-contentful-paint"]?.numericValue || 0),
      largestContentfulPaint: Math.round(audits["largest-contentful-paint"]?.numericValue || 0),
      totalBlockingTime: Math.round(audits["total-blocking-time"]?.numericValue || 0),
      cumulativeLayoutShift: parseFloat((audits["cumulative-layout-shift"]?.numericValue || 0).toFixed(3)),
      speedIndex: Math.round(audits["speed-index"]?.numericValue || 0),
    };
    return { metrics, failure: null };
  } catch (error) {
    // Log Google's OWN message, not just the status code. A bare "status code 400" is
    // undiagnosable; the body says exactly why (e.g. "Lighthouse returned error: NO_FCP —
    // the page did not paint any content").
    const apiMessage = (error as any)?.response?.data?.error?.message;
    const documentCode = extractLighthouseError(error);
    const isTimeout =
      (error as any)?.code === "ECONNABORTED" ||
      String((error as any)?.message || "").includes("timeout");

    logger.warn(
      {
        url,
        strategy,
        error: error instanceof Error ? error.message : error,
        googleMessage: apiMessage ? String(apiMessage).slice(0, 300) : undefined,
        lighthouseFailure: documentCode ?? undefined,
      },
      "PageSpeed API call failed"
    );

    if (documentCode) return { metrics: null, failure: "document", code: documentCode };
    return { metrics: null, failure: isTimeout ? "timeout" : "other" };
  }
}

/**
 * One strategy, through the concurrency gate, retried ONCE and only on a timeout.
 *
 * A document-level Lighthouse failure is deterministic — retrying it just burns another 90
 * seconds and produces the same answer — so it returns immediately with its code.
 */
async function fetchScoreGated(
  url: string,
  strategy: "mobile" | "desktop"
): Promise<{ metrics: PageSpeedMetrics | null; documentFailure: string | null }> {
  await reportGate.acquire();
  try {
    let result = await fetchScore(url, strategy);
    if (!result.metrics && result.failure === "timeout") {
      logger.info({ url, strategy }, "PageSpeed timed out — retrying once");
      result = await fetchScore(url, strategy);
    }
    return {
      metrics: result.metrics,
      documentFailure: result.failure === "document" ? result.code ?? "unknown" : null,
    };
  } finally {
    reportGate.release();
  }
}

/**
 * Get both mobile and desktop Lighthouse scores for a URL.
 * Runs SEQUENTIALLY (desktop first, then mobile) to avoid Google rate-limiting.
 * Returns null entirely if API key is missing or URL is invalid.
 */
export async function getPageSpeedScores(url: string): Promise<PageSpeedResult | null> {
  if (!API_KEY) return null;

  if (!url || (!url.startsWith("http://") && !url.startsWith("https://"))) {
    return null;
  }

  // Both strategies at once, NOT one after the other.
  //
  // Measured against Google's live API, a single four-category run takes 30–95s and the
  // variance is Google's, not ours — it boots a real headless Chrome per request. Sequentially
  // that is up to 190s per lead before the retry, and every second of it is time the report is
  // on screen with no gauges. Run in parallel the wall-clock is one run, not two, and the
  // report gate below caps how many are in flight process-wide anyway.
  const [desktop, mobile] = await Promise.all([
    fetchScoreGated(url, "desktop"),
    fetchScoreGated(url, "mobile"),
  ]);

  // When BOTH strategies hit a document-level failure, Google's own browser could not render
  // this page at all. That is a finding about the site, so it is carried through rather than
  // discarded as "no data" — a homepage that paints nothing is worth telling the owner about.
  const renderFailure =
    !mobile.metrics && !desktop.metrics && (mobile.documentFailure || desktop.documentFailure)
      ? mobile.documentFailure || desktop.documentFailure
      : null;

  if (!mobile.metrics && !desktop.metrics && !renderFailure) return null;

  return { mobile: mobile.metrics, desktop: desktop.metrics, renderFailure };
}

/**
 * Second opinion: can GOOGLE reach this site?
 *
 * Our own "site is down" verdict is only as good as our network path to the site. A site can
 * be perfectly healthy and still be unreachable from where we happen to be running — AWS and
 * Cloudflare edges drop traffic from some networks and regions outright (observed: two live
 * Florida businesses, both fully loadable by Google, both TCP-timing-out from a machine in
 * India). Publishing "your website is down" on the strength of that is exactly the kind of
 * claim a prospect disproves in one click.
 *
 * So before that verdict is allowed, Google gets asked. One mobile run, performance category
 * only, to keep it as cheap as this path can be. Returns:
 *   true  — Google loaded it, so the site is UP and the failure is on our side
 *   false — Google could not load it either, so "down" is corroborated
 *   null  — we couldn't get an answer; caller should treat the site as unverified, not down
 */
export async function canGoogleReachSite(url: string): Promise<boolean | null> {
  if (!API_KEY || !url) return null;
  await probeGate.acquire();
  try {
    const response = await axios.get(API_URL, {
      params: { url, strategy: "mobile", key: API_KEY, category: "performance" },
      timeout: TIMEOUT,
    });
    const score = response.data?.lighthouseResult?.categories?.performance?.score;
    return score !== undefined && score !== null;
  } catch (error) {
    // A document-level Lighthouse failure means Google DID connect but the page rendered
    // nothing — the host is answering, so the domain is not dead.
    if (extractLighthouseError(error)) return true;
    const status = (error as any)?.response?.status;
    // 400 with no recognised code, or a 5xx from Google, tells us nothing about the site.
    if (status && status >= 500) return null;
    const apiMessage: string = (error as any)?.response?.data?.error?.message || "";
    if (/DNS|ENOTFOUND|Unable to reach|FAILED_DOCUMENT_REQUEST/i.test(apiMessage)) return false;
    return null;
  } finally {
    probeGate.release();
  }
}

// ---------------------------------------------------------------------------
// Background fetch
// ---------------------------------------------------------------------------
// A Lighthouse run is 25–90s per strategy, twice per lead. Awaiting that inside an HTTP
// request means the browser times out long before the server finishes — the user sees
// "Request timed out" while the work actually completes, which is exactly how a 25-lead
// campaign appeared to fail and then showed all its emails on refresh.
//
// Nothing in a request needs these numbers immediately: the audit link is opened by the
// prospect minutes or hours later. So the fetch is detached and merged into the row when it
// lands, and the audit view keeps its own fetch as a backstop.
const inFlightLeads = new Set<string>();

/**
 * Is a Lighthouse run for this lead running RIGHT NOW in this process?
 *
 * The public report endpoint uses this to tell the browser "the gauges are coming, keep
 * asking". Without it the report rendered once, 20 seconds before the data landed, and the
 * prospect had to guess that a manual refresh would fill it in.
 */
export function isPageSpeedInFlight(leadId: string): boolean {
  return inFlightLeads.has(leadId);
}

export function schedulePageSpeedInBackground(leadId: string, url: string): void {
  if (!leadId || !url || inFlightLeads.has(leadId)) return;
  inFlightLeads.add(leadId);

  setImmediate(async () => {
    try {
      if (!API_KEY) {
        logger.warn({ leadId }, "PAGESPEED_API_KEY not set — skipping Lighthouse");
        return;
      }

      // Each strategy is stored the INSTANT it lands, rather than both being held until the
      // slower one finishes. The two runs differ by a minute or more, and one of them can burn
      // a further 90s on its timeout retry — waiting for the pair meant a desktop result that
      // was ready in 30s sat unwritten while mobile timed out, so the report showed nothing at
      // all instead of showing half. Half the gauges beats none.
      let storedAny = false;

      const runOne = async (strategy: "mobile" | "desktop"): Promise<string | null> => {
        const { metrics, documentFailure } = await fetchScoreGated(url, strategy);
        if (metrics) {
          await mergeEnrichedData(leadId, (ed) => ({
            pageSpeed: {
              mobile: null,
              desktop: null,
              ...(ed.pageSpeed || {}),
              [strategy]: metrics,
            },
          }));
          storedAny = true;
          logger.info({ leadId, url, strategy, performance: metrics.performanceScore }, "PageSpeed stored");
        }
        return documentFailure;
      };

      const [desktopFailure, mobileFailure] = await Promise.all([
        runOne("desktop"),
        runOne("mobile"),
      ]);

      if (storedAny) return;

      const renderFailure = desktopFailure || mobileFailure;
      if (renderFailure) {
        // Google's browser reached the page but nothing painted. That is a finding about the
        // site, so it is recorded rather than discarded as "no data".
        await mergeEnrichedData(leadId, {
          pageSpeed: { mobile: null, desktop: null, renderFailure },
        });
        logger.info({ leadId, url, renderFailure }, "PageSpeed render failure recorded");
        return;
      }

      // Stamp the failure so the public report view backs off for a while. Written only on
      // FAILURE — stamping before the attempt is what locked leads out for a whole day.
      await mergeEnrichedData(leadId, { pageSpeedTriedAt: new Date().toISOString() });
      logger.warn({ leadId, url }, "PageSpeed produced no data for either strategy");
    } catch (err) {
      logger.warn({ leadId, url, err }, "Background PageSpeed fetch failed");
    } finally {
      inFlightLeads.delete(leadId);
    }
  });
}
