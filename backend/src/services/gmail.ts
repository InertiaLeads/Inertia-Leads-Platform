import { google } from "googleapis";
import crypto from "crypto";
import supabase from "./supabase";
import { setGmailConnectedAt } from "./planLimits";
import { encrypt, decrypt } from "../utils/encryption";
import { encodeMimeHeader } from "../utils/emailFormat";

// Create OAuth2 client
function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI
  );
}

// HMAC key for signing OAuth state — reuses the encryption key
function getStateSigningKey(): Buffer {
  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (!key || key.length !== 64) {
    throw new Error("TOKEN_ENCRYPTION_KEY required for OAuth state signing");
  }
  return Buffer.from(key, "hex");
}

// Sign a payload with HMAC-SHA256 → "payload.signature"
function signState(payload: string): string {
  const sig = crypto.createHmac("sha256", getStateSigningKey()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

// Verify HMAC signature and return decoded payload (or null if tampered)
function verifyAndDecodeState(state: string): { userId: string; ts: number } | null {
  const dotIndex = state.lastIndexOf(".");
  if (dotIndex === -1) return null;
  const payload = state.slice(0, dotIndex);
  const sig = state.slice(dotIndex + 1);
  const expected = crypto.createHmac("sha256", getStateSigningKey()).update(payload).digest("base64url");
  // Timing-safe comparison to prevent timing attacks
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!decoded.userId || typeof decoded.userId !== "string") return null;
    if (typeof decoded.ts !== "number") return null;
    return decoded;
  } catch {
    return null;
  }
}

// Generate the OAuth2 consent URL with HMAC-signed CSRF-protection state
export function getAuthUrl(userId: string): string {
  const oauth2Client = getOAuth2Client();
  const payload = Buffer.from(JSON.stringify({ userId, ts: Date.now() })).toString("base64url");
  const state = signState(payload);
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    state,
    scope: [
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/userinfo.email",
    ],
  });
}

// Verify OAuth state signature + matches the authenticated user
export function verifyOAuthState(state: string, userId: string): boolean {
  const decoded = verifyAndDecodeState(state);
  if (!decoded) return false;
  if (decoded.userId !== userId) return false;
  // Reject states older than 10 minutes
  if (Date.now() - decoded.ts > 10 * 60 * 1000) return false;
  return true;
}

// Extract userId from HMAC-signed OAuth state (for GET callback without auth header)
export function extractOAuthStateUserId(state: string): string | null {
  const decoded = verifyAndDecodeState(state);
  if (!decoded) return null;
  // Reject states older than 10 minutes
  if (Date.now() - decoded.ts > 10 * 60 * 1000) return null;
  return decoded.userId;
}

// Exchange authorization code for tokens and store them
export async function handleOAuthCallback(
  code: string,
  userId: string
): Promise<{ success: boolean; email?: string; accountId?: string }> {
  const oauth2Client = getOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error("Failed to get tokens from Google");
  }

  oauth2Client.setCredentials(tokens);

  // Get the user's Gmail email address
  const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
  const userInfo = await oauth2.userinfo.get();
  const gmailEmail = userInfo.data.email || "";

  // Check if this email is already connected for this user (re-auth)
  const { data: existing } = await supabase
    .from("gmail_accounts")
    .select("id")
    .eq("user_id", userId)
    .eq("email", gmailEmail)
    .single();

  if (existing) {
    // Re-auth existing account — update tokens only
    await supabase
      .from("gmail_accounts")
      .update({
        access_token: encrypt(tokens.access_token),
        refresh_token: encrypt(tokens.refresh_token),
        token_expiry: new Date(tokens.expiry_date || Date.now() + 3600000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);

    return { success: true, email: gmailEmail, accountId: existing.id };
  }

  // New account — check if this is the first (primary)
  const { count: existingCount } = await supabase
    .from("gmail_accounts")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);

  const isPrimary = (existingCount || 0) === 0;

  const { data: newAccount, error } = await supabase
    .from("gmail_accounts")
    .insert({
      user_id: userId,
      email: gmailEmail,
      access_token: encrypt(tokens.access_token),
      refresh_token: encrypt(tokens.refresh_token),
      token_expiry: new Date(tokens.expiry_date || Date.now() + 3600000).toISOString(),
      is_primary: isPrimary,
      warmup_started_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error || !newAccount) {
    throw new Error("Failed to store Gmail account");
  }

  // Start user-level warmup clock (only sets once, for primary inbox)
  if (isPrimary) {
    await setGmailConnectedAt(userId);
  }

  return { success: true, email: gmailEmail, accountId: newAccount.id };
}

// Get a valid access token for a specific Gmail account (refreshes if expired)
async function getValidAccessToken(gmailAccountId: string): Promise<string> {
  const { data: account, error } = await supabase
    .from("gmail_accounts")
    .select("*")
    .eq("id", gmailAccountId)
    .single();

  if (error || !account) {
    throw new Error("Gmail account not found. Please reconnect your Gmail.");
  }

  const now = new Date();
  const expiry = new Date(account.token_expiry);

  // If token is still valid (with 5min buffer), return it
  if (expiry.getTime() - now.getTime() > 5 * 60 * 1000) {
    return decrypt(account.access_token);
  }

  // Token expired — refresh it
  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({ refresh_token: decrypt(account.refresh_token) });

  const { credentials } = await oauth2Client.refreshAccessToken();

  if (!credentials.access_token) {
    throw new Error("Failed to refresh Gmail access token");
  }

  // Update stored token (encrypted)
  await supabase
    .from("gmail_accounts")
    .update({
      access_token: encrypt(credentials.access_token),
      token_expiry: new Date(credentials.expiry_date || Date.now() + 3600000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", gmailAccountId);

  return credentials.access_token;
}

// Look up the sender's display name (their profile full_name) for the From header.
// Gmail otherwise falls back to the Google account's profile name (e.g. "aman"),
// which reads as impersonal. Returns "" if no name is set.
async function getSenderDisplayName(userId: string): Promise<string> {
  try {
    const { data, error } = await supabase.auth.admin.getUserById(userId);
    if (error || !data?.user) return "";
    const meta = (data.user.user_metadata || {}) as Record<string, string>;
    return (meta.full_name || "").trim();
  } catch {
    return "";
  }
}

// Format a From header value as `"Display Name" <email>`, RFC 2047-encoding the
// name when it contains non-ASCII. Falls back to the bare address if no name.
function formatFromHeader(email: string, displayName: string): string {
  // Strip characters that could break out of the display name / inject headers.
  const safeName = displayName.replace(/["\\<>\r\n]/g, "").trim();
  if (!safeName) return email;
  // Pure ASCII → quoted-string; non-ASCII → RFC 2047 encoded-word (must NOT be quoted).
  const isAscii = /^[\x20-\x7E]*$/.test(safeName);
  const namePart = isAscii ? `"${safeName}"` : encodeMimeHeader(safeName);
  return `${namePart} <${email}>`;
}

export interface ThreadingOptions {
  inReplyTo?: string;   // Message-ID of the message this one replies to
  references?: string;  // space-separated Message-ID chain of the thread
  threadId?: string;    // Gmail API thread id to file this message into
}

// Send an email via Gmail API using a specific Gmail account.
// Returns the RFC 2822 Message-ID we stamped on the message and the Gmail thread id,
// so follow-ups can be threaded under it.
export async function sendEmail(
  gmailAccountId: string,
  to: string,
  subject: string,
  body: string,
  threading?: ThreadingOptions
): Promise<{ success: boolean; messageId?: string; threadId?: string }> {
  // Fetch account for token, email address, and owner (for display name lookup)
  const { data: account, error: accountError } = await supabase
    .from("gmail_accounts")
    .select("email, user_id")
    .eq("id", gmailAccountId)
    .single();

  const accessToken = await getValidAccessToken(gmailAccountId);

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  // Sanitize inputs to prevent email header injection
  const safeTo = to.replace(/[\r\n]/g, "");
  const safeSubject = subject.replace(/[\r\n]/g, "");

  // Send as a single plain-text part — no HTML, no List-Unsubscribe header — so the
  // email reads like a personal 1:1 message and lands in Primary, not Promotions.
  const text = body.trimEnd();

  // Stamp our own Message-ID so we can thread follow-ups against it. Gmail preserves
  // a caller-supplied Message-ID header; using our own avoids a follow-up read-back call.
  const senderEmail = (!accountError && account?.email) ? account.email : "";
  const domain = senderEmail.split("@")[1] || "mail.gmail.com";
  const messageId = `<${crypto.randomBytes(16).toString("hex")}@${domain}>`;

  const headers: string[] = [];
  // From with display name (supports send-as aliases). Falls back to bare address.
  if (senderEmail) {
    const displayName = account?.user_id ? await getSenderDisplayName(account.user_id) : "";
    headers.push(`From: ${formatFromHeader(senderEmail, displayName)}`);
  }
  headers.push(
    `To: ${safeTo}`,
    // Subject may contain non-ASCII (em-dash, smart quotes, emoji). Headers are
    // ASCII-only, so RFC 2047-encode it — otherwise Gmail renders it as mojibake.
    `Subject: ${encodeMimeHeader(safeSubject)}`,
    `Message-ID: ${messageId}`,
  );
  // Threading headers — present only on follow-ups. Gmail uses these plus the Re:
  // subject and threadId to file the message into the original conversation.
  const inReplyTo = threading?.inReplyTo?.replace(/[\r\n]/g, "");
  const references = threading?.references?.replace(/[\r\n]/g, "");
  if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`);
  if (references) headers.push(`References: ${references}`);
  headers.push(
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset="UTF-8"`,
  );

  const rawEmail = headers.join("\n") + "\n\n" + text;

  const encodedEmail = Buffer.from(rawEmail)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const result = await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw: encodedEmail,
      // Filing into an existing thread requires the threadId AND a matching Re:
      // subject + References headers (all set above).
      ...(threading?.threadId ? { threadId: threading.threadId } : {}),
    },
  });

  return {
    success: true,
    messageId,
    threadId: result.data.threadId || undefined,
  };
}

// Check if user has Gmail connected (any account)
export async function isGmailConnected(userId: string): Promise<{ connected: boolean; email?: string }> {
  const { data, error } = await supabase
    .from("gmail_accounts")
    .select("email")
    .eq("user_id", userId)
    .eq("is_primary", true)
    .single();

  if (error || !data) {
    return { connected: false };
  }

  return { connected: true, email: data.email };
}

// Get all connected Gmail accounts for a user
export async function getGmailAccounts(userId: string): Promise<Array<{
  id: string;
  email: string;
  is_primary: boolean;
  warmup_started_at: string;
  created_at: string;
}>> {
  const { data } = await supabase
    .from("gmail_accounts")
    .select("id, email, is_primary, warmup_started_at, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  return data || [];
}

// Get user's primary Gmail account ID
export async function getPrimaryGmailAccountId(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from("gmail_accounts")
    .select("id")
    .eq("user_id", userId)
    .eq("is_primary", true)
    .single();

  return data?.id || null;
}

// Remove a non-primary Gmail account and reassign its pending emails
export async function removeGmailAccount(userId: string, accountId: string): Promise<void> {
  const { data } = await supabase
    .from("gmail_accounts")
    .select("is_primary")
    .eq("id", accountId)
    .eq("user_id", userId)
    .single();

  if (!data) throw new Error("Gmail account not found");

  // Allow removing primary only if it's the sole account (for reconnection)
  if (data.is_primary) {
    const { count } = await supabase
      .from("gmail_accounts")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId);
    if (count && count > 1) throw new Error("Cannot remove your primary Gmail account while other accounts exist. Remove secondary accounts first.");
  }

  // Reassign pending emails from this inbox to the primary inbox
  const primaryId = await getPrimaryGmailAccountId(userId);
  if (primaryId) {
    await supabase
      .from("emails")
      .update({ gmail_account_id: primaryId })
      .eq("gmail_account_id", accountId)
      .eq("status", "pending");
  }

  await supabase
    .from("gmail_accounts")
    .delete()
    .eq("id", accountId)
    .eq("user_id", userId);
}

// Count emails sent today from a specific Gmail account
export async function getInboxSentToday(gmailAccountId: string): Promise<number> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const { count } = await supabase
    .from("emails")
    .select("*", { count: "exact", head: true })
    .eq("gmail_account_id", gmailAccountId)
    .eq("status", "sent")
    .gte("sent_at", today.toISOString());
  return count || 0;
}
