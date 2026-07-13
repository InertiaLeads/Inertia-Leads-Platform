import axios from "axios";
import logger from "../utils/logger";

export interface LeadFinderParams {
  niche: string;
  location: string;
  limit?: number;
}

export interface FoundLead {
  name: string;
  email?: string;
  company: string;
  website?: string;
  phone?: string;
  industry?: string;
  address?: string;
  rating?: number;
  ratingCount?: number;
}

interface SerperPlace {
  title?: string;
  address?: string;
  phone?: string;
  phoneNumber?: string;
  website?: string;
  category?: string;
  rating?: number;
  ratingCount?: number;
  cid?: string; // Google's unique business id — used to dedupe repeated listings across pages
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Call Serper Places with retries. Retries transient failures (network / 429 / 5xx) with a short
 * backoff; does NOT retry auth errors (401/403) since those won't fix themselves. Throws the last
 * error if every attempt fails, so callers can distinguish a real failure from a genuine "no results".
 */
async function serperPlacesRequest(apiKey: string, q: string, page: number, attempts = 3) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await axios.post(
        "https://google.serper.dev/places",
        { q, page },
        {
          headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
          timeout: 10000,
        }
      );
    } catch (error) {
      lastError = error;
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      // Auth/config errors are permanent — don't waste retries on them.
      if (status === 401 || status === 403) break;
      if (attempt < attempts) await sleep(500 * attempt); // 500ms, then 1000ms backoff
    }
  }
  throw lastError;
}

/**
 * Find leads using Serper.dev Google Maps/Places API.
 * Returns [] ONLY when the provider genuinely returned no matching businesses.
 * THROWS when the provider fails (after retries) so the caller can surface a real error
 * instead of a misleading "0 leads found".
 */
export async function findLeadsByNiche(
  params: LeadFinderParams
): Promise<FoundLead[]> {
  const { niche, location, limit = 50 } = params;

  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    logger.error("SERPER_API_KEY not set");
    throw new Error("Lead search is not configured. Please contact support.");
  }

  logger.info({ niche, location, limit }, "Searching for leads");

  const leads: FoundLead[] = [];
  const seenCids = new Set<string>();
  let page = 1;

  try {
    // Serper returns ~10 results per page, so paginate until we hit the limit
    while (leads.length < limit) {
      const response = await serperPlacesRequest(apiKey, `${niche} in ${location}`, page);
      const places: SerperPlace[] = response.data?.places || [];

      logger.info(
        { query: `${niche} in ${location}`, page, rawPlacesFromSerper: places.length },
        "Serper places page"
      );

      if (places.length === 0) break;

      for (const place of places) {
        if (leads.length >= limit) break;

        const company = place.title?.trim();
        if (!company) continue;

        // Skip the same Google business if it appears again (Serper can repeat a listing across pages)
        if (place.cid) {
          if (seenCids.has(place.cid)) continue;
          seenCids.add(place.cid);
        }

        // Keep every real business (it has a name, and usually an address). Serper frequently
        // omits phone/website for many listings — very common for US results — so we must NOT drop
        // contactless places here, or good searches (e.g. "dentists in Chicago") wrongly return 0.
        // The enrichment step afterwards discovers the website + contact info, and prunes any lead
        // that stays truly unreachable.
        leads.push({
          name: company,
          company,
          website: place.website || "",
          phone: place.phone || place.phoneNumber || "",
          industry: place.category || niche,
          address: place.address || "",
          rating: place.rating,
          ratingCount: place.ratingCount,
        });
      }

      // If we got fewer results than a full page, no more pages
      if (places.length < 10) break;
      page++;

      // Safety cap: don't exceed 5 API calls per search
      if (page > 5) break;

      await sleep(300); // small pause between pages to avoid provider throttling
    }
  } catch (error) {
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;
    logger.error(
      { error: error instanceof Error ? error.message : error, status, niche, location, gathered: leads.length },
      "Error finding leads"
    );
    // If earlier pages already returned leads, keep them rather than discarding the whole search.
    if (leads.length > 0) {
      logger.info({ count: leads.length }, "Leads found (partial — a later page failed)");
      return leads;
    }
    // No leads gathered and the provider failed → surface a real error to the caller.
    throw new Error("The lead search service is temporarily unavailable. Please try again in a moment.");
  }

  logger.info({ count: leads.length }, "Leads found");
  return leads;
}

/**
 * Validate and clean lead data
 */
export function validateLead(lead: FoundLead): boolean {
  // A real business name is enough to accept the lead at find-time. Contact info (email / phone /
  // website) is filled in during enrichment; leads that remain uncontactable are pruned then.
  // (Serper often returns businesses without contact fields, so requiring them here would drop
  // valid leads and make good searches return 0.)
  return !!lead.company && lead.company.trim().length > 0;
}

/**
 * Format leads for database insertion
 */
export function formatLeadsForDB(
  leads: FoundLead[],
  userId: string,
  sourceId: string
): any[] {
  return leads
    .filter(validateLead)
    .map((lead) => {
      const hasEmail = !!lead.email?.includes("@");
      const hasWebsite = !!lead.website?.startsWith("http");
      return {
        user_id: userId,
        source_id: sourceId,
        name: lead.name || lead.company,
        email: lead.email || "",
        company: lead.company,
        website: lead.website || "",
        phone: lead.phone || "",
        industry: lead.industry || "",
        contact_method: hasEmail ? "email" : "call",
        enriched_data: {
          ...(lead.address ? { address: lead.address } : {}),
          ...(lead.rating !== undefined ? { googleRating: lead.rating } : {}),
          ...(lead.ratingCount !== undefined ? { googleReviewCount: lead.ratingCount } : {}),
        },
      };
    });
}

/**
 * Discover a business website via Serper web search when Places API didn't return one
 */
export async function discoverWebsite(companyName: string, industry?: string): Promise<string | null> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) return null;

  try {
    const query = industry ? `${companyName} ${industry} official website` : `${companyName} official website`;
    const response = await axios.post(
      "https://google.serper.dev/search",
      { q: query, num: 5 },
      {
        headers: {
          "X-API-KEY": apiKey,
          "Content-Type": "application/json",
        },
        timeout: 5000,
      }
    );

    const results = response.data?.organic || [];
    // Skip aggregator/directory sites — we want the actual business website
    const skipDomains = [
      "facebook.com", "instagram.com", "twitter.com", "x.com", "linkedin.com",
      "yelp.com", "yellowpages.com", "bbb.org", "mapquest.com", "tripadvisor.com",
      "nextdoor.com", "thumbtack.com", "angi.com", "homeadvisor.com", "manta.com",
      "chamberofcommerce.com", "google.com", "apple.com/maps", "pinterest.com",
    ];

    for (const result of results) {
      const link: string = result.link || "";
      if (!link.startsWith("http")) continue;
      const domain = new URL(link).hostname.toLowerCase().replace("www.", "");
      if (skipDomains.some(skip => domain.includes(skip))) continue;
      // Return the root domain URL
      const parsed = new URL(link);
      return `${parsed.protocol}//${parsed.hostname}`;
    }
    return null;
  } catch {
    return null;
  }
}
