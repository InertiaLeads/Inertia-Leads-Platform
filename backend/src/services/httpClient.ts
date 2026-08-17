import axios from "axios";
import { URL } from "url";
import dns from "dns/promises";
import dnsCb from "dns";
import http from "http";
import https from "https";
import net from "net";

// =============================================
// SSRF-safe outbound HTTP client
// =============================================
// Every outbound fetch the enrichment pipeline makes (page scrape, robots.txt,
// sitemap, link checks) must go through these agents. They validate the ACTUAL IP
// at socket-connect time — including on each redirect hop — so a public hostname
// that redirects to (or re-resolves to) an internal address can't be reached.
//
// Extracted from scraper.ts so the SEO/marketing analyzers share exactly the same
// protection instead of re-implementing it.

// Block private/internal IPv4
function isPrivateIP(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4) return true; // block anything weird

  // 10.0.0.0/8
  if (parts[0] === 10) return true;
  // 172.16.0.0/12
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  // 192.168.0.0/16
  if (parts[0] === 192 && parts[1] === 168) return true;
  // 127.0.0.0/8 (localhost)
  if (parts[0] === 127) return true;
  // 169.254.0.0/16 (link-local / cloud metadata)
  if (parts[0] === 169 && parts[1] === 254) return true;
  // 0.0.0.0
  if (parts.every((p) => p === 0)) return true;

  return false;
}

// Block private/internal IPv6 (loopback, link-local, unique-local, IPv4-mapped forms)
function isBlockedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  const mapped = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isPrivateIP(mapped[1]);
  if (lower === "::1" || lower === "::") return true;                // loopback / unspecified
  if (lower.startsWith("fe80:")) return true;                         // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;  // unique-local fc00::/7
  return false;
}

// Unified check: is this resolved IP (v4 or v6) internal/disallowed?
export function isBlockedAddress(ip: string): boolean {
  return ip.includes(":") ? isBlockedIPv6(ip) : isPrivateIP(ip);
}

// Custom DNS lookup used by the HTTP(S) agents below. It runs at socket-connect time
// for EVERY connection — including each redirect hop — so it closes SSRF-via-redirect
// and DNS-rebinding by validating the actual IP we're about to connect to, not just
// the original URL string.
function safeLookup(hostname: string, options: any, callback: any): void {
  (dnsCb.lookup as any)(hostname, options, (err: any, address: any, family: any) => {
    if (err) return callback(err, address, family);
    const entries = Array.isArray(address) ? address : [{ address, family }];
    for (const entry of entries) {
      const ip = typeof entry === "string" ? entry : entry.address;
      if (isBlockedAddress(ip)) {
        return callback(new Error(`SSRF blocked: ${hostname} resolves to disallowed IP ${ip}`), address, family);
      }
    }
    callback(null, address, family);
  });
}

// HTTP(S) agents that enforce safeLookup on every connection. Reused across all
// outbound fetches (passed as httpAgent/httpsAgent), so redirects and rebinding can't
// reach internal addresses. Legitimate public redirects still work normally.
export const safeHttpAgent = new http.Agent();
export const safeHttpsAgent = new https.Agent();
for (const agent of [safeHttpAgent, safeHttpsAgent]) {
  const orig = (agent as any).createConnection.bind(agent);
  (agent as any).createConnection = (opts: any, cb: any) => {
    // Literal IPs skip DNS resolution entirely, so safeLookup never runs for them —
    // validate a literal-IP host directly here (this is the primary SSRF target, e.g.
    // a redirect to http://169.254.169.254/). Hostnames are validated by safeLookup at
    // resolution time, which also catches DNS-rebinding.
    const host: string = opts.host || opts.hostname || "";
    if (host && net.isIP(host) && isBlockedAddress(host)) {
      const err = new Error(`SSRF blocked: direct connection to disallowed IP ${host}`);
      if (typeof cb === "function") { cb(err); return undefined; }
      throw err;
    }
    return orig({ ...opts, lookup: safeLookup }, cb);
  };
}

// Pre-flight URL check: protocol allow-list + DNS resolution against private ranges.
// The agents above are the real guarantee; this is a cheap early reject.
export async function isUrlSafe(websiteUrl: string): Promise<boolean> {
  try {
    const parsed = new URL(websiteUrl);

    // Only allow http/https
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

    // Block localhost hostnames
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === "localhost" || hostname === "0.0.0.0" || hostname.endsWith(".local")) return false;

    // Resolve DNS and check if it points to a private IP
    try {
      const addresses = await dns.resolve4(hostname);
      for (const ip of addresses) {
        if (isPrivateIP(ip)) return false;
      }
    } catch {
      // No A record — check if it has only AAAA (IPv6)
      try {
        const ipv6Addresses = await dns.resolve6(hostname);
        for (const ip of ipv6Addresses) {
          if (isBlockedIPv6(ip)) return false;
        }
      } catch {
        // Cannot resolve at all — block it
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Are two hosts the same site?
 *
 * Compares with a leading `www.` stripped. This matters more than it looks: a site
 * requested as https://www.example.com that canonicalises to https://example.com would
 * otherwise have EVERY one of its own internal links classified as external, silently
 * zeroing out link-health and conversion-path analysis. Roughly half of small-business
 * sites redirect one way or the other.
 */
export function isSameSite(hostA: string, hostB: string): boolean {
  const strip = (h: string) => h.toLowerCase().replace(/^www\./, "");
  return strip(hostA) === strip(hostB);
}

// Browser-ish headers. Many small-business sites (and the WAFs in front of them)
// reject requests without them.
export const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

/**
 * GET a URL through the SSRF-safe agents. Returns null on any failure so callers
 * can treat "couldn't check" as "no signal" rather than crashing enrichment.
 */
export async function safeGet(
  url: string,
  opts: { timeout?: number; maxBytes?: number; maxRedirects?: number } = {}
): Promise<{ status: number; data: string; finalUrl: string; headers: Record<string, any> } | null> {
  if (!(await isUrlSafe(url))) return null;
  try {
    const response = await axios.get(url, {
      timeout: opts.timeout ?? 8000,
      maxRedirects: opts.maxRedirects ?? 5,
      maxContentLength: opts.maxBytes ?? 1024 * 1024,
      httpAgent: safeHttpAgent,
      httpsAgent: safeHttpsAgent,
      headers: BROWSER_HEADERS,
      responseType: "text",
      transformResponse: [(d) => d], // keep raw text — don't let axios JSON.parse XML/plain
      validateStatus: () => true,
    });
    return {
      status: response.status,
      data: typeof response.data === "string" ? response.data : String(response.data ?? ""),
      finalUrl: (response.request?.res?.responseUrl as string) || url,
      headers: response.headers as Record<string, any>,
    };
  } catch {
    return null;
  }
}

/**
 * Status-only probe used by the broken-link checker. Tries HEAD first (cheap), then
 * falls back to GET because a meaningful number of servers/WAFs reject HEAD with
 * 403/405 even though the page itself is fine — treating that as "broken" would
 * produce false accusations in a report we send to a prospect.
 *
 * `maxRedirects: 0` so the caller can tell a redirect apart from a real response.
 */
export async function safeProbe(
  url: string,
  timeout = 6000
): Promise<{ status: number; location: string | null } | null> {
  if (!(await isUrlSafe(url))) return null;
  const config = {
    timeout,
    maxRedirects: 0,
    httpAgent: safeHttpAgent,
    httpsAgent: safeHttpsAgent,
    headers: BROWSER_HEADERS,
    validateStatus: () => true,
  };
  try {
    const r = await axios.head(url, config);
    // HEAD rejected by the server, not by the resource — re-check with GET.
    if (r.status === 403 || r.status === 405 || r.status === 501) {
      const g = await axios.get(url, { ...config, maxContentLength: 64 * 1024, responseType: "text", transformResponse: [(d) => d] });
      return { status: g.status, location: (g.headers?.location as string) || null };
    }
    return { status: r.status, location: (r.headers?.location as string) || null };
  } catch {
    try {
      const g = await axios.get(url, { ...config, maxContentLength: 64 * 1024, responseType: "text", transformResponse: [(d) => d] });
      return { status: g.status, location: (g.headers?.location as string) || null };
    } catch {
      return null; // genuinely unreachable / timed out — caller decides how to treat it
    }
  }
}
