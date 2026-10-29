import { Router, Request, Response } from "express";
import { authMiddleware, AuthenticatedRequest } from "../middleware/auth";
import { requireFeature } from "../middleware/featureGate";
import { isValidUUID } from "../middleware/validate";
import { verifyTrackingToken } from "../utils/trackingToken";
import { recordOpen, recordClick, recordAuditClick, getCampaignTrackingStats } from "../services/tracking";
import { onTrackingEvent } from "../services/smartSequences";
import logger from "../utils/logger";

// =============================================
// PUBLIC tracking endpoints — mounted at /t (no auth, no CORS, no API rate limiter)
// =============================================
// These are hit by recipients' mail clients and browsers, never by our frontend.
// Hard rule: they must NEVER fail visibly. The pixel always returns a GIF; the redirect
// always sends the visitor somewhere sensible.

export const publicTrackingRouter = Router();

// 1x1 transparent GIF (43 bytes)
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

function sendPixel(res: Response): void {
  res.set({
    "Content-Type": "image/gif",
    "Content-Length": String(PIXEL.length),
    "Cache-Control": "no-store, no-cache, must-revalidate, private",
    Pragma: "no-cache",
    Expires: "0",
    // helmet defaults to Cross-Origin-Resource-Policy: same-origin, which makes browsers
    // (Outlook web, Yahoo, webmail clients that load images directly) REFUSE to render an
    // <img> served from our origin inside their page. The pixel must be embeddable anywhere.
    "Cross-Origin-Resource-Policy": "cross-origin",
  });
  res.status(200).end(PIXEL);
}

function safeFallbackUrl(): string {
  return (process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/+$/, "");
}

// GET /t/o/:token — open pixel
publicTrackingRouter.get("/o/:token", async (req: Request, res: Response) => {
  // Respond immediately; record in the background so a slow DB never delays the client.
  sendPixel(res);
  try {
    const parsed = verifyTrackingToken("o", req.params.token);
    if (!parsed) return;
    const email = await recordOpen(parsed.emailId, req.ip || "", req.headers["user-agent"]);
    if (email) {
      onTrackingEvent(email.id, "open").catch((err) => logger.warn({ err }, "Smart sequence evaluation failed (open)"));
    }
  } catch (err) {
    logger.warn({ err }, "Open tracking failed");
  }
});

// GET /t/c/:token — click redirect
publicTrackingRouter.get("/c/:token", async (req: Request, res: Response) => {
  let destination = safeFallbackUrl();
  try {
    const parsed = verifyTrackingToken("c", req.params.token);
    if (parsed) {
      const { url, email } = await recordClick(parsed.emailId, parsed.index, req.ip || "", req.headers["user-agent"]);
      if (url) destination = url;
      if (email) {
        onTrackingEvent(email.id, "click", url || undefined).catch((err) => logger.warn({ err }, "Smart sequence evaluation failed (click)"));
      }
    }
  } catch (err) {
    logger.warn({ err }, "Click tracking failed");
  }
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.redirect(302, destination);
});

// GET /audit/:token on the tracking host — short audit link in outreach emails.
// Mounted at the ROOT (server.ts), before CORS/rate limiting, like the routes above.
// Always redirects to the real audit page; recording happens after the redirect is sent.
export async function auditClickRedirect(req: Request, res: Response): Promise<void> {
  const raw = String(req.params.token || "").replace(/[.,;:!?)]+$/, "");
  const frontend = (process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/+$/, "");
  const valid = /^[A-Za-z0-9_-]{10,30}$/.test(raw);
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.redirect(302, valid ? `${frontend}/audit/${raw}` : frontend);
  if (!valid) return;
  try {
    const { email, url } = await recordAuditClick(raw, req.ip || "", req.headers["user-agent"]);
    if (email) {
      onTrackingEvent(email.id, "click", url).catch((err) => logger.warn({ err }, "Smart sequence evaluation failed (audit click)"));
    }
  } catch (err) {
    logger.warn({ err }, "Audit click tracking failed");
  }
}

// =============================================
// AUTHENTICATED stats — mounted at /api/tracking
// =============================================
export const trackingApiRouter = Router();

// GET /api/tracking/campaign/:id — aggregate + per-lead engagement for the campaign page
trackingApiRouter.get("/campaign/:id", authMiddleware, requireFeature("emailTracking", "Email tracking"), async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    if (!isValidUUID(id)) {
      res.status(400).json({ error: "Invalid campaign ID format" });
      return;
    }
    const stats = await getCampaignTrackingStats(req.userId!, id);
    if (!stats) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    res.json(stats);
  } catch (err) {
    logger.error({ err }, "Failed to load tracking stats");
    res.status(500).json({ error: "Failed to load tracking stats" });
  }
});
