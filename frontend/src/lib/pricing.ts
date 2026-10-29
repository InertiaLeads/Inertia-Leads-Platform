// =============================================
// Public list prices (USD / month) — single source of truth for the frontend
// =============================================
// Must match backend/src/services/planLimits.ts PLAN_CONFIGS.priceMonthly and the
// prices of the products configured in Dodo (DODO_*_PRODUCT_ID).
//
// V2 Tier 1 pricing (2026-10): Growth and Agency gained email tracking, smart sequences,
// the unified inbox and AI reply sorting. Starter gained nothing, so it keeps its price.
// One price list for every user — no grandfathering.
export const LIST_PRICES = { starter: 39, growth: 99, agency: 149 } as const;

export type PlanKey = keyof typeof LIST_PRICES;

export function listPrice(plan: string): number {
  return LIST_PRICES[(plan in LIST_PRICES ? plan : "starter") as PlanKey];
}
