import { Router } from "express";
import { authMiddleware, AuthenticatedRequest } from "../middleware/auth";
import { testSmtpConnection, addSmtpAccount, getSmtpAccounts, removeSmtpAccount } from "../services/smtp";
import { getUserPlan, getMaxInboxes, checkSubscriptionAccess } from "../services/planLimits";
import { getGmailAccounts } from "../services/gmail";

const router = Router();

// POST /api/smtp/test — Test SMTP connection before saving
router.post("/test", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { email, host, port, username, password, useTls } = req.body;

    if (!email || !host || !port || !username || !password) {
      res.status(400).json({ error: "All SMTP fields are required (email, host, port, username, password)" });
      return;
    }

    const result = await testSmtpConnection({ email, host, port, username, password, useTls });

    if (result.success) {
      res.json({ message: "SMTP connection successful" });
    } else {
      // result.error is already a fixed, non-revealing category (see describeSmtpFailure).
      res.status(400).json({ error: result.error });
    }
  } catch {
    res.status(500).json({ error: "Failed to test SMTP connection" });
  }
});

// POST /api/smtp/accounts — Add a new SMTP account
router.post("/accounts", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { email, displayName, host, port, username, password, useTls } = req.body;

    if (!email || !host || !port || !username || !password) {
      res.status(400).json({ error: "All SMTP fields are required" });
      return;
    }

    // SECURITY: Check subscription access before allowing new connections
    const accessCheck = await checkSubscriptionAccess(req.userId!);
    if (!accessCheck.hasAccess) {
      res.status(403).json({ error: accessCheck.reason });
      return;
    }

    // Check total inbox limit (Gmail + SMTP combined)
    const gmailAccounts = await getGmailAccounts(req.userId!);
    const smtpAccounts = await getSmtpAccounts(req.userId!);
    const { plan } = await getUserPlan(req.userId!);
    const maxInboxes = getMaxInboxes(plan);
    const totalInboxes = gmailAccounts.length + smtpAccounts.length;

    // Allow update of existing SMTP account even at limit
    const isExisting = smtpAccounts.some(a => a.email === email);
    if (totalInboxes >= maxInboxes && !isExisting) {
      res.status(403).json({
        error: `Your ${plan} plan allows up to ${maxInboxes} email account${maxInboxes > 1 ? "s" : ""} (Gmail + SMTP combined). Upgrade to add more.`,
      });
      return;
    }

    // Test connection first
    const testResult = await testSmtpConnection({ email, host, port, username, password, useTls });
    if (!testResult.success) {
      res.status(400).json({ error: testResult.error });
      return;
    }

    const account = await addSmtpAccount(req.userId!, {
      email,
      displayName,
      host,
      port,
      username,
      password,
      useTls,
    });

    res.json({
      message: "SMTP account connected successfully",
      account,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to add SMTP account";
    res.status(400).json({ error: msg });
  }
});

// GET /api/smtp/accounts — List all SMTP accounts
router.get("/accounts", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const accounts = await getSmtpAccounts(req.userId!);
    res.json({ accounts });
  } catch {
    res.status(500).json({ error: "Failed to fetch SMTP accounts" });
  }
});

// DELETE /api/smtp/accounts/:id — Remove an SMTP account
import { isValidUUID } from "../middleware/validate";

router.delete("/accounts/:id", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const accountId = req.params.id;
    if (!isValidUUID(accountId)) {
      res.status(400).json({ error: "Invalid account ID format" });
      return;
    }
    await removeSmtpAccount(req.userId!, accountId);
    res.json({ message: "SMTP account removed successfully" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to remove SMTP account";
    res.status(400).json({ error: msg });
  }
});

export default router;
