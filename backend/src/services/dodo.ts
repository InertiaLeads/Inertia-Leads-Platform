import DodoPayments from "dodopayments";

// =============================================
// Dodo Payments — shared client + plan/status maps
// =============================================
// Central place for the SDK client and the product↔plan / status mappings so
// billing.ts and webhooks.ts stay in sync. Dodo is a Merchant of Record like the
// previous provider; the app still owns the 7-day free trial (Dodo checkouts are
// created with trial_period_days: 0, so Dodo never grants its own trial).

let client: DodoPayments | null = null;

// Which Dodo environment to talk to. DODO_ENVIRONMENT wins when set explicitly
// ("test_mode" | "live_mode"); otherwise it falls back to NODE_ENV so a dev/staging
// server never hits live billing by accident.
//
// The explicit override matters: a production Railway deploy has NODE_ENV=production,
// but live_mode only works once Dodo has APPROVED the account for live payments. Until
// then every live_mode call fails, so a production deploy must be able to run against
// Dodo test mode. Set DODO_ENVIRONMENT=test_mode to do that.
export function getDodoEnvironment(): "test_mode" | "live_mode" {
  const explicit = process.env.DODO_ENVIRONMENT?.trim();
  if (explicit === "test_mode" || explicit === "live_mode") return explicit;
  return process.env.NODE_ENV === "production" ? "live_mode" : "test_mode";
}

// Lazily build the SDK client. Bearer token = the Dodo API key. NOTE: the API key is
// environment-specific — a test-mode key used against live_mode (or vice versa) fails
// authentication, as do product IDs created in the other environment.
export function getDodoClient(): DodoPayments {
  if (client) return client;
  const bearerToken = process.env.DODO_PAYMENTS_API_KEY;
  if (!bearerToken) throw new Error("DODO_PAYMENTS_API_KEY not configured");
  client = new DodoPayments({
    bearerToken,
    environment: getDodoEnvironment(),
  });
  return client;
}

// Flatten a Dodo SDK error into something loggable. The SDK throws APIError objects whose
// useful detail lives in `status` and the parsed response body — `err.message` alone is
// often just "500 Internal Server Error", which is why failures were undiagnosable.
export function describeDodoError(err: any): Record<string, unknown> {
  return {
    message: err?.message,
    status: err?.status ?? err?.statusCode,
    code: err?.code,
    type: err?.type,
    body: err?.error ?? err?.response?.data ?? err?.body,
    environment: getDodoEnvironment(),
  };
}

// Each DODO_*_PRODUCT_ID may hold SEVERAL comma-separated product IDs: the FIRST is the
// current product (used for new checkouts and plan changes); any others are older products
// some subscriptions may still reference. All of them map back to the same plan tier, so
// replacing a product in Dodo can never silently downgrade a subscriber to Starter.
//   DODO_GROWTH_PRODUCT_ID=pdt_current,pdt_previous
function productIdsFor(envValue: string | undefined): string[] {
  return (envValue || "").split(",").map((s) => s.trim()).filter(Boolean);
}

function productEnv(): Record<string, string[]> {
  return {
    starter: productIdsFor(process.env.DODO_STARTER_PRODUCT_ID),
    growth: productIdsFor(process.env.DODO_GROWTH_PRODUCT_ID),
    agency: productIdsFor(process.env.DODO_AGENCY_PRODUCT_ID),
  };
}

// Plan tier → current Dodo product ID (first in the list).
export function getProductId(plan: string): string {
  return productEnv()[plan]?.[0] || "";
}

// Dodo product ID → plan tier (reverse lookup for webhooks). Matches current AND legacy
// products. Defaults to "starter".
export function getPlanFromProduct(productId: string): string {
  if (!productId) return "starter";
  for (const [plan, ids] of Object.entries(productEnv())) {
    if (ids.includes(productId)) return plan;
  }
  return "starter";
}

// Dodo subscription status → our internal subscription_status. Same target values
// the previous provider mapped to, so all downstream access-gating is unchanged.
//   Dodo: pending | active | on_hold | cancelled | failed | expired
export function mapDodoStatus(dodoStatus: string): string {
  switch (dodoStatus) {
    case "active":
      return "active";
    case "on_hold":
      return "past_due";
    case "cancelled":
      return "cancelled";
    case "expired":
      return "expired";
    case "pending":
    case "failed":
    default:
      return "none";
  }
}
