import nodemailer from "nodemailer";
import supabase from "./supabase";
import logger from "../utils/logger";
import { encrypt, decrypt } from "../utils/encryption";

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
    const msg = err instanceof Error ? err.message : "Connection failed";
    logger.error({ error: msg, host: config.host, port: config.port }, "SMTP connection test failed");
    return { success: false, error: msg };
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

// Send an email via SMTP
export async function sendViaSMTP(
  smtpAccountId: string,
  to: string,
  subject: string,
  body: string,
  listUnsubscribeUrl?: string
): Promise<{ success: boolean; messageId?: string }> {
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

  const result = await transporter.sendMail({
    from: fromAddress,
    to: safeTo,
    subject: safeSubject,
    text,
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
