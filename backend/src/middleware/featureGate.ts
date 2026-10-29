import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "./auth";
import { getUserPlan, getFeatureAccess, FeatureAccess } from "../services/planLimits";

// Route-level plan gating. Mirrors the frontend FeatureGate: the UI hides locked features,
// this makes sure the API refuses them too (the UI is never the real gate).
export function requireFeature(feature: keyof FeatureAccess, label: string) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const plan = await getUserPlan(req.userId!);
      const features = getFeatureAccess(plan.plan, plan.isOnTrial);
      if (!features[feature]) {
        res.status(403).json({
          error: `${label} is available on the Growth and Agency plans. Upgrade to unlock it.`,
          upgradeRequired: true,
          feature,
        });
        return;
      }
      next();
    } catch {
      res.status(500).json({ error: "Failed to verify plan access" });
    }
  };
}
