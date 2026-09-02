import nodemailer from "nodemailer";
import supabase from "./supabase";
import logger from "../utils/logger";
import { encrypt, decrypt } from "../utils/encryption";
import { isHostSafe } from "./httpClient";

// Ports a real mail submission service listens on. Anything else is either a
// non-SMTP service (the thing an internal port scan is actually hunting for) or a
// misconfiguration, so it is refused rather than dialled.
const ALLOWED_SMTP_PORTS = [25, 465, 587, 2525];

/**
 * Map a driver error to one of a few fixed categories.
 *
 * The raw nodemailer/socket error was previously returned to the caller verbatim,
 * which made this endpoint an oracle: connection-refused vs timeout vs TLS-handshake
 * distinguishes an open internal port from a closed one. These buckets still tell a
 * legitimate user which field to correct.
 */
function describeSmtpFailure(err: unknown): string {
  const code = String((err as { code?: string })?.code || "");
  const message = err instanceof Error ? err.message : String(err);

  if (code === "EAUTH" || /auth|credential|password|username|535|534/i.test(message)) {
    return "Authentication failed — check your username and password (app passwords are usually required).";
  }
  if (code === "ESOCKET" || /certificate|self.signed|tls|ssl/i.test(message)) {
    return "Secure connection failed — check the port and whether your provider requires SSL or STARTTLS.";
  }
  return "Could not reach the mail server — check the host and port.";
}

// =============================================
// SMTP Account Management
// =============================================

export interface SmtpAccountInput {
  email: string;
  displayName?: string;
  host: string;
  port: number;
  username: string;
  password: string;
  useTls?: boolean;
}

// Test SMTP connection before saving
export async function testSmtpConnection(config: SmtpAccountInput): Promise<{ success: boolean; error?: string }> {
  // Refuse non-submission ports BEFORE opening a socket. Combined with the host check
  // below this is what stops the endpoint being used to probe internal services.
  const port = Number(config.port);
  if (!ALLOWED_SMTP_PORTS.includes(port)) {
    return {
      success: false,
      error: `Unsupported SMTP port. Use one of: ${ALLOWED_SMTP_PORTS.join(", ")}.`,
    };
  }

  // The host must resolve to a PUBLIC address. Without this, an authenticated user can
  // point the tester at 127.0.0.1, 169.254.169.254 (cloud metadata) or any RFC1918
  // address and read connection outcomes — an internal port scanner behind a login.
  if (!(await isHostSafe(config.host))) {
    logger.warn({ host: config.host, port }, "Blocked SMTP connection to non-public host");
    return {
      success: false,
      error: "That mail server host is not reachable. Enter a public SMTP hostname (for example smtp.zoho.com).",
    };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: {
        user: config.username,
        pass: config.password,
      },
      tls: {
        rejectUnauthorized: config.useTls !== false,
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
    });

    await transporter.verify();
    transporter.close();
    return { success: true };
  } catch (err) {
    // Full detail stays in our logs; the caller gets a category, never the raw error.
    const msg = err instanceof Error ? err.message : "Connection failed";
    logger.error({ error: msg, host: config.host, port: config.port }, "SMTP connection test failed");
    return { success: false, error: describeSmtpFailure(err) };
  }
}

// Add an SMTP account for a user
export async function addSmtpAccount(
  userId: string,
  config: SmtpAccountInput
): Promise<{ id: string; email: string }> {
  // Check if this email is already connected
  const { data: existing } = await supabase
    .from("smtp_accounts")
    .select("id")
    .eq("user_id", userId)
    .eq("email", config.email)
    .single();

  if (existing) {
    // Update existing account
    await supabase
      .from("smtp_accounts")
      .update({
        display_name: config.displayName || "",
        host: config.host,
        port: config.port,
        username: config.username,
        password_encrypted: encrypt(config.password),
        use_tls: config.useTls !== false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);

    return { id: existing.id, email: config.email };
  }

  // Check if this is the first email account overall (Gmail + SMTP)
  const { count: gmailCount } = await supabase
    .from("gmail_accounts")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);

  const { count: smtpCount } = await supabase
    .from("smtp_accounts")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);

  const isPrimary = ((gmailCount || 0) + (smtpCount || 0)) === 0;

  const { data: newAccount, error } = await supabase
    .from("smtp_accounts")
    .insert({
      user_id: userId,
      email: config.email,
      display_name: config.displayName || "",
      host: config.host,
      port: config.port,
      username: config.username,
      password_encrypted: encrypt(config.password),
      use_tls: config.useTls !== false,
      is_primary: isPrimary,
      warmup_started_at: new Date().toISOString(),
    })
    .select("id, email")
    .single();

  if (error || !newAccount) {
    throw new Error("Failed to store SMTP account");
  }

  // Start warmup clock if this is the first account
  if (isPrimary) {
    const { setGmailConnectedAt } = await import("./planLimits");
    await setGmailConnectedAt(userId);
  }

  return { id: newAccount.id, email: newAccount.email };
}

// Get all SMTP accounts for a user (without passwords)
export async function getSmtpAccounts(userId: string): Promise<Array<{
  id: string;
  email: string;
  display_name: string;
  host: string;
  port: number;
  is_primary: boolean;
  warmup_started_at: string;
  created_at: string;
}>> {
  const { data } = await supabase
    .from("smtp_accounts")
    .select("id, email, display_name, host, port, is_primary, warmup_started_at, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  return data || [];
}

// Remove an SMTP account (non-primary only)
export async function removeSmtpAccount(userId: string, accountId: string): Promise<void> {
  const { data } = await supabase
    .from("smtp_accounts")
    .select("is_primary")
    .eq("id", accountId)
    .eq("user_id", userId)
    .single();

  if (!data) throw new Error("SMTP account not found");
  if (data.is_primary) throw new Error("Cannot remove your primary email account");

  // Reassign pending emails to primary Gmail account
  const { getPrimaryGmailAccountId } = await import("./gmail");
  const primaryGmailId = await getPrimaryGmailAccountId(userId);
  if (primaryGmailId) {
    await supabase
      .from("emails")
      .update({ smtp_account_id: null, gmail_account_id: primaryGmailId })
      .eq("smtp_account_id", accountId)
      .eq("status", "pending");
  }

  await supabase
    .from("smtp_accounts")
    .delete()
    .eq("id", accountId)
    .eq("user_id", userId);
}

// Send an email via SMTP.
// Returns the Message-ID nodemailer stamped on the message so follow-ups can be
// threaded under it via In-Reply-To / References (SMTP has no Gmail-style threadId).
export async function sendViaSMTP(
  smtpAccountId: string,
  to: string,
  subject: string,
  body: string,
  threading?: { inReplyTo?: string; references?: string }
): Promise<{ success: boolean; messageId?: string; threadId?: string }> {
  const { data: account, error } = await supabase
    .from("smtp_accounts")
    .select("*")
    .eq("id", smtpAccountId)
    .single();

  if (error || !account) {
    throw new Error("SMTP account not found. Please reconnect.");
  }

  const password = decrypt(account.password_encrypted);

  const transporter = nodemailer.createTransport({
    host: account.host,
    port: account.port,
    secure: account.port === 465,
    auth: {
      user: account.username,
      pass: password,
    },
    tls: {
      rejectUnauthorized: account.use_tls !== false,
    },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  });

  // Sanitize inputs to prevent email header injection
  const safeTo = to.replace(/[\r\n]/g, "");
  const safeSubject = subject.replace(/[\r\n]/g, "");

  // Strip quotes, backslashes, and control chars from display name to prevent From header injection
  const safeName = (account.display_name || "")
    .replace(/["\\<>\r\n]/g, "")
    .trim();

  const fromAddress = safeName
    ? `"${safeName}" <${account.email}>`
    : account.email;

  // Plain-text only — no HTML, no List-Unsubscribe header — so the email reads like
  // a personal 1:1 message and lands in Primary, not Promotions. (nodemailer
  // RFC 2047-encodes the subject automatically.)
  const text = body.trimEnd();

  // Threading headers (follow-ups only). nodemailer emits In-Reply-To / References
  // from these; combined with the Re: subject, clients group the sequence as one thread.
  const inReplyTo = threading?.inReplyTo?.replace(/[\r\n]/g, "") || undefined;
  const references = threading?.references?.replace(/[\r\n]/g, "") || undefined;

  const result = await transporter.sendMail({
    from: fromAddress,
    to: safeTo,
    subject: safeSubject,
    text,
    ...(inReplyTo ? { inReplyTo } : {}),
    ...(references ? { references } : {}),
  });

  transporter.close();

  return {
    success: true,
    messageId: result.messageId || undefined,
  };
}

// Count emails sent today from a specific SMTP account
export async function getSmtpInboxSentToday(smtpAccountId: string): Promise<number> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const { count } = await supabase
    .from("emails")
    .select("*", { count: "exact", head: true })
    .eq("smtp_account_id", smtpAccountId)
    .eq("status", "sent")
    .gte("sent_at", today.toISOString());
  return count || 0;
}
