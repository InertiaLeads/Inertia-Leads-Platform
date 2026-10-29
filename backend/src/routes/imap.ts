import { Router } from "express";
import { authMiddleware, AuthenticatedRequest } from "../middleware/auth";
import { isValidUUID, isValidEmail } from "../middleware/validate";
import { requireFeature } from "../middleware/featureGate";
import { checkSubscriptionAccess } from "../services/planLimits";
import { detectImapSettings, testImapConnection, addImapCredential, getImapCredentials, removeImapCredential } from "../services/imap";
import { auditLog } from "../utils/auditLog";

const router = Router();
const gate = requireFeature("unifiedInbox", "The Unified Inbox");

function parseInput(body: Record<string, unknown>) {
  const email = String(body.email || "").trim().toLowerCase();
  const host = String(body.host || "").trim();
  const port = Number(body.port || 993);
  const username = String(body.username || email).trim();
  const password = String(body.password || "");
  const useTls = body.useTls !== false;
  return { email, host, port, username, password, useTls };
}

// GET /api/imap/detect?email= — suggest IMAP host/port for an address
router.get("/detect", authMiddleware, gate, async (req: AuthenticatedRequest, res) => {
  try {
    const email = String(req.query.email || "").trim().toLowerCase();
    if (!email || !isValidEmail(email)) {
      res.status(400).json({ error: "A valid email address is required" });
      return;
    }
    const settings = await detectImapSettings(email);
    res.json({ email, ...settings });
  } catch {
    res.status(500).json({ error: "Failed to detect inbox settings" });
  }
});

// POST /api/imap/test — try the credentials without saving
router.post("/test", authMiddleware, gate, async (req: AuthenticatedRequest, res) => {
  try {
    const input = parseInput(req.body || {});
    if (!input.email || !input.host || !input.port || !input.username || !input.password) {
      res.status(400).json({ error: "Email, IMAP host, port and app password are required" });
      return;
    }
    const result = await testImapConnection(input);
    if (result.success) res.json({ message: "Inbox connection successful" });
    else res.status(400).json({ error: result.error });
  } catch {
    res.status(500).json({ error: "Failed to test inbox connection" });
  }
});

// POST /api/imap/accounts — connect (or re-connect) an inbox
router.post("/accounts", authMiddleware, gate, async (req: AuthenticatedRequest, res) => {
  try {
    const input = parseInput(req.body || {});
    if (!input.email || !isValidEmail(input.email) || !input.host || !input.port || !input.username || !input.password) {
      res.status(400).json({ error: "Email, IMAP host, port and app password are required" });
      return;
    }

    const access = await checkSubscriptionAccess(req.userId!);
    if (!access.hasAccess) {
      res.status(403).json({ error: access.reason });
      return;
    }

    const test = await testImapConnection(input);
    if (!test.success) {
      res.status(400).json({ error: test.error });
      return;
    }

    const account = await addImapCredential(req.userId!, input);
    auditLog({ userId: req.userId, action: "imap.connect", resource: "imap_credentials", resourceId: account.id, req, metadata: { email: account.email, host: input.host } });
    res.json({ message: "Inbox connected. Replies will start appearing within a few minutes.", account });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Failed to connect inbox" });
  }
});

// GET /api/imap/accounts — list connected inboxes (never includes passwords)
router.get("/accounts", authMiddleware, gate, async (req: AuthenticatedRequest, res) => {
  try {
    const accounts = await getImapCredentials(req.userId!);
    res.json({ accounts });
  } catch {
    res.status(500).json({ error: "Failed to fetch inbox connections" });
  }
});

// DELETE /api/imap/accounts/:id — disconnect an inbox (fetched replies are kept)
router.delete("/accounts/:id", authMiddleware, gate, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    if (!isValidUUID(id)) {
      res.status(400).json({ error: "Invalid account ID format" });
      return;
    }
    await removeImapCredential(req.userId!, id);
    auditLog({ userId: req.userId, action: "imap.disconnect", resource: "imap_credentials", resourceId: id, req });
    res.json({ message: "Inbox disconnected" });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Failed to disconnect inbox" });
  }
});

export default router;
