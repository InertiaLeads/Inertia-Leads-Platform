import DodoPayments from "dodopayments";

// =============================================
// Dodo Payments — shared client + plan/status maps
// =============================================
// Central place for the SDK client and the product↔plan / status mappings so
// billing.ts and webhooks.ts stay in sync. Dodo is a Merchant of Record like the
// previous provider; the app still owns the 7-day free trial (Dodo checkouts are
// created with trial_period_days: 0, so Dodo never grants its own trial).

let client: DodoPayments | null = null;

// Lazily build the SDK client. Test vs live is chosen by NODE_ENV so we never hit
// live billing from a dev/staging server. Bearer token = the Dodo API key.
export function getDodoClient(): DodoPayments {
  if (client) return client;
  const bearerToken = process.env.DODO_PAYMENTS_API_KEY;
  if (!bearerToken) throw new Error("DODO_PAYMENTS_API_KEY not configured");
  client = new DodoPayments({
    bearerToken,
    environment: process.env.NODE_ENV === "production" ? "live_mode" : "test_mode",
  });
  return client;
}

// Plan tier → Dodo product ID (from the dashboard). Mirrors the old VARIANT_MAP.
export function getProductId(plan: string): string {
  const map: Record<string, string> = {
    starter: process.env.DODO_STARTER_PRODUCT_ID || "",
    growth: process.env.DODO_GROWTH_PRODUCT_ID || "",
    agency: process.env.DODO_AGENCY_PRODUCT_ID || "",
  };
  return map[plan] || "";
}

// Dodo product ID → plan tier (reverse lookup for webhooks). Defaults to "starter".
export function getPlanFromProduct(productId: string): string {
  const map: Record<string, string> = {
    [process.env.DODO_STARTER_PRODUCT_ID || ""]: "starter",
    [process.env.DODO_GROWTH_PRODUCT_ID || ""]: "growth",
    [process.env.DODO_AGENCY_PRODUCT_ID || ""]: "agency",
  };
  return (productId && map[productId]) || "starter";
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
