import { sendEmail as sendViaGmail, getGmailAccounts, getPrimaryGmailAccountId, getInboxSentToday as getGmailInboxSentToday } from "./gmail";
import { sendViaSMTP, getSmtpAccounts, getSmtpInboxSentToday } from "./smtp";
import supabase from "./supabase";

// Unified email account type used for inbox rotation
export interface EmailAccount {
  id: string;
  email: string;
  type: "gmail" | "smtp";
  is_primary: boolean;
  warmup_started_at: string;
  created_at: string;
}

// Get all email accounts (Gmail + SMTP) for a user
export async function getAllEmailAccounts(userId: string): Promise<EmailAccount[]> {
  const [gmailAccounts, smtpAccounts] = await Promise.all([
    getGmailAccounts(userId),
    getSmtpAccounts(userId),
  ]);

  const accounts: EmailAccount[] = [
    ...gmailAccounts.map(a => ({
      id: a.id,
      email: a.email,
      type: "gmail" as const,
      is_primary: a.is_primary,
      warmup_started_at: a.warmup_started_at,
      created_at: a.created_at,
    })),
    ...smtpAccounts.map(a => ({
      id: a.id,
      email: a.email,
      type: "smtp" as const,
      is_primary: a.is_primary,
      warmup_started_at: a.warmup_started_at,
      created_at: a.created_at,
    })),
  ];

  return accounts.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

// Get the primary email account (Gmail or SMTP)
export async function getPrimaryEmailAccountId(userId: string): Promise<{ id: string; type: "gmail" | "smtp" } | null> {
  // Check Gmail first (most common)
  const gmailId = await getPrimaryGmailAccountId(userId);
  if (gmailId) return { id: gmailId, type: "gmail" };

  // Check SMTP
  const { data } = await supabase
    .from("smtp_accounts")
    .select("id")
    .eq("user_id", userId)
    .eq("is_primary", true)
    .single();

  if (data) return { id: data.id, type: "smtp" };
  return null;
}

// Threading identifiers for stitching a follow-up into its original conversation.
export interface ThreadingOptions {
  inReplyTo?: string;   // Message-ID of the message this one replies to
  references?: string;  // space-separated Message-ID chain of the thread
  threadId?: string;    // Gmail API thread id (ignored by SMTP)
}

// Unified send — routes to Gmail API or SMTP based on account type.
// Returns the Message-ID and (Gmail) thread id of this send for follow-up threading.
export async function sendEmailUnified(
  accountId: string,
  accountType: "gmail" | "smtp",
  to: string,
  subject: string,
  body: string,
  threading?: ThreadingOptions
): Promise<{ success: boolean; messageId?: string; threadId?: string }> {
  if (accountType === "gmail") {
    return sendViaGmail(accountId, to, subject, body, threading);
  } else {
    return sendViaSMTP(accountId, to, subject, body, threading);
  }
}

// Unified inbox sent today count
export async function getInboxSentTodayUnified(accountId: string, accountType: "gmail" | "smtp"): Promise<number> {
  if (accountType === "gmail") {
    return getGmailInboxSentToday(accountId);
  } else {
    return getSmtpInboxSentToday(accountId);
  }
}

// Determine account type from an email row (has gmail_account_id or smtp_account_id)
export function getAccountInfo(email: { gmail_account_id?: string | null; smtp_account_id?: string | null }): { id: string; type: "gmail" | "smtp" } | null {
  if (email.gmail_account_id) return { id: email.gmail_account_id, type: "gmail" };
  if (email.smtp_account_id) return { id: email.smtp_account_id, type: "smtp" };
  return null;
}

// Assign an account to an email row (sets the right column)
export function buildAccountAssignment(accountId: string, accountType: "gmail" | "smtp"): Record<string, string | null> {
  if (accountType === "gmail") {
    return { gmail_account_id: accountId, smtp_account_id: null };
  } else {
    return { gmail_account_id: null, smtp_account_id: accountId };
  }
}
