import { Router } from "express";
import { authMiddleware, AuthenticatedRequest } from "../middleware/auth";
import { getAuthUrl, handleOAuthCallback, isGmailConnected, getGmailAccounts, removeGmailAccount, verifyOAuthState, extractOAuthStateUserId } from "../services/gmail";
import { getUserPlan, getMaxInboxes, checkSubscriptionAccess } from "../services/planLimits";
import { isValidUUID } from "../middleware/validate";
import { auditLog } from "../utils/auditLog";

const router = Router();

// GET /api/gmail/auth-url — Get the Gmail OAuth consent URL
router.get("/auth-url", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    // SECURITY: Check subscription access before allowing new connections
    const accessCheck = await checkSubscriptionAccess(req.userId!);
    if (!accessCheck.hasAccess) {
      res.status(403).json({ error: accessCheck.reason });
      return;
    }

    // Check inbox limit before starting OAuth flow
    const accounts = await getGmailAccounts(req.userId!);
    const { plan } = await getUserPlan(req.userId!);
    const maxInboxes = getMaxInboxes(plan);

    if (accounts.length >= maxInboxes) {
      res.status(403).json({
        error: `Your ${plan} plan allows up to ${maxInboxes} Gmail account${maxInboxes > 1 ? "s" : ""}. Upgrade your plan to add more.`,
      });
      return;
    }

    const url = getAuthUrl(req.userId!);
    res.json({ url });
  } catch {
    res.status(500).json({ error: "Failed to generate Gmail auth URL" });
  }
});

// GET /api/gmail/callback — Handle OAuth2 callback redirect from Google
// No authMiddleware: Google redirects here without a Bearer token.
// User identity is verified via the signed state parameter instead.
router.get("/callback", async (req, res) => {
  // Google redirects the BROWSER here, so we must respond with an HTTP redirect back to the
  // frontend Settings page (not JSON). The full-page load re-fetches connected inboxes, so the
  // Gmail card shows the newly connected address; the ?gmail= param drives a success/error toast.
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
  try {
    const code = req.query.code as string;
    const state = req.query.state as string;

    if (!code) {
      res.redirect(`${frontendUrl}/settings?gmail=error`);
      return;
    }

    const userId = extractOAuthStateUserId(state);
    if (!userId) {
      res.redirect(`${frontendUrl}/settings?gmail=error`);
      return;
    }

    await handleOAuthCallback(code, userId);
    res.redirect(`${frontendUrl}/settings?gmail=connected`);
  } catch {
    res.redirect(`${frontendUrl}/settings?gmail=error`);
  }
});

// POST /api/gmail/callback — Handle OAuth2 code sent from frontend
router.post("/callback", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { code, state } = req.body;

    if (!code) {
      res.status(400).json({ error: "Authorization code is required" });
      return;
    }

    if (!state || !verifyOAuthState(state, req.userId!)) {
      res.status(403).json({ error: "Invalid or expired OAuth state. Please start the connection process again." });
      return;
    }

    const result = await handleOAuthCallback(code, req.userId!);
    auditLog({ userId: req.userId, action: "gmail.connect", resource: "gmail_accounts", req, metadata: { email: result.email } });
    res.json({
      message: "Gmail connected successfully",
      email: result.email,
    });
  } catch {
    res.status(500).json({ error: "Failed to connect Gmail" });
  }
});

// GET /api/gmail/status — Check if Gmail is connected
router.get("/status", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const status = await isGmailConnected(req.userId!);
    res.json(status);
  } catch {
    res.status(500).json({ error: "Failed to check Gmail status" });
  }
});

// GET /api/gmail/accounts — List all connected Gmail accounts + plan info
router.get("/accounts", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const accounts = await getGmailAccounts(req.userId!);
    const { plan } = await getUserPlan(req.userId!);
    const maxInboxes = getMaxInboxes(plan);
    res.json({ accounts, maxInboxes, plan });
  } catch {
    res.status(500).json({ error: "Failed to fetch Gmail accounts" });
  }
});

// DELETE /api/gmail/accounts/:id — Remove a non-primary Gmail account
router.delete("/accounts/:id", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const accountId = req.params.id;
    if (!isValidUUID(accountId)) {
      res.status(400).json({ error: "Invalid account ID format" });
      return;
    }
    await removeGmailAccount(req.userId!, accountId);
    auditLog({ userId: req.userId, action: "gmail.disconnect", resource: "gmail_accounts", resourceId: accountId, req });
    res.json({ message: "Gmail account removed successfully" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to remove Gmail account";
    res.status(400).json({ error: msg });
  }
});

export default router;
