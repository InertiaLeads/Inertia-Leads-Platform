import { ImapFlow } from "imapflow";
import { simpleParser, ParsedMail } from "mailparser";
import dns from "dns";
import supabase from "./supabase";
import logger from "../utils/logger";
import { encrypt, decrypt } from "../utils/encryption";
import { isHostSafe } from "./httpClient";

// =============================================
// IMAP inbox access (app passwords)
// =============================================
// Reply fetching deliberately uses IMAP + app passwords for EVERY provider (including Gmail)
// instead of the Gmail API's readonly scope: that scope is "restricted" and requires Google's
// CASA security assessment before the OAuth app can be verified for it. Sending is unchanged
// (Gmail OAuth gmail.send / SMTP). Credentials are encrypted at rest with the same
// AES-256-GCM helper used for SMTP passwords.

// IMAP submission ports only. Same reasoning as ALLOWED_SMTP_PORTS in smtp.ts: refusing
// arbitrary ports (together with the public-host check) stops the "test connection" endpoint
// being used to probe internal services.
const ALLOWED_IMAP_PORTS = [993, 143];

export interface ImapSettings {
  host: string;
  port: number;
  provider: string;
  note?: string;
  // true when the provider no longer accepts password/app-password IMAP sign-in at all
  // (Microsoft: outlook.com, hotmail, live, Microsoft 365). Connecting would always fail.
  unsupported?: boolean;
}

const MS_NOTE = "Microsoft no longer allows password-based inbox access for Outlook.com, Hotmail and Microsoft 365. Sending from this account still works, but reply sync for Outlook isn't available yet.";

// Well-known providers. Key = mail domain. Google Workspace / Microsoft 365 custom domains
// are resolved through their MX records below.
const IMAP_PRESETS: Record<string, ImapSettings> = {
  "gmail.com": { host: "imap.gmail.com", port: 993, provider: "gmail" },
  "googlemail.com": { host: "imap.gmail.com", port: 993, provider: "gmail" },
  "outlook.com": { host: "outlook.office365.com", port: 993, provider: "outlook", unsupported: true, note: MS_NOTE },
  "hotmail.com": { host: "outlook.office365.com", port: 993, provider: "outlook", unsupported: true, note: MS_NOTE },
  "live.com": { host: "outlook.office365.com", port: 993, provider: "outlook", unsupported: true, note: MS_NOTE },
  "msn.com": { host: "outlook.office365.com", port: 993, provider: "outlook", unsupported: true, note: MS_NOTE },
  "office365.com": { host: "outlook.office365.com", port: 993, provider: "outlook", unsupported: true, note: MS_NOTE },
  "yahoo.com": { host: "imap.mail.yahoo.com", port: 993, provider: "yahoo" },
  "yahoo.co.uk": { host: "imap.mail.yahoo.com", port: 993, provider: "yahoo" },
  "ymail.com": { host: "imap.mail.yahoo.com", port: 993, provider: "yahoo" },
  "aol.com": { host: "imap.aol.com", port: 993, provider: "aol" },
  "zoho.com": { host: "imap.zoho.com", port: 993, provider: "zoho" },
  "zohomail.com": { host: "imap.zoho.com", port: 993, provider: "zoho" },
  "zoho.eu": { host: "imap.zoho.eu", port: 993, provider: "zoho" },
  "zoho.in": { host: "imap.zoho.in", port: 993, provider: "zoho" },
  "icloud.com": { host: "imap.mail.me.com", port: 993, provider: "icloud" },
  "me.com": { host: "imap.mail.me.com", port: 993, provider: "icloud" },
  "mac.com": { host: "imap.mail.me.com", port: 993, provider: "icloud" },
  "protonmail.com": { host: "127.0.0.1", port: 1143, provider: "proton", note: "Proton Mail requires the Proton Bridge app; IMAP is not available directly." },
  "proton.me": { host: "127.0.0.1", port: 1143, provider: "proton", note: "Proton Mail requires the Proton Bridge app; IMAP is not available directly." },
  "fastmail.com": { host: "imap.fastmail.com", port: 993, provider: "fastmail" },
  "gmx.com": { host: "imap.gmx.com", port: 993, provider: "gmx" },
  "gmx.net": { host: "imap.gmx.net", port: 993, provider: "gmx" },
  "gmx.de": { host: "imap.gmx.net", port: 993, provider: "gmx" },
  "web.de": { host: "imap.web.de", port: 993, provider: "webde" },
  "mail.com": { host: "imap.mail.com", port: 993, provider: "mailcom" },
  "yandex.com": { host: "imap.yandex.com", port: 993, provider: "yandex" },
  "yandex.ru": { host: "imap.yandex.ru", port: 993, provider: "yandex" },
};

// Detect IMAP settings for an address. Order: known consumer domain → MX record of a custom
// domain (Google Workspace, Microsoft 365, Zoho, Yahoo Business) → imap.<domain> guess.
export async function detectImapSettings(email: string): Promise<ImapSettings & { guessed: boolean }> {
  const domain = (email.split("@")[1] || "").toLowerCase().trim();
  if (!domain) return { host: "", port: 993, provider: "custom", guessed: true };

  const preset = IMAP_PRESETS[domain];
  if (preset) return { ...preset, guessed: false };

  try {
    const mx = await dns.promises.resolveMx(domain);
    const hosts = mx.map((m) => m.exchange.toLowerCase());
    if (hosts.some((h) => h.endsWith("google.com") || h.endsWith("googlemail.com"))) {
      return { host: "imap.gmail.com", port: 993, provider: "gmail", guessed: false };
    }
    if (hosts.some((h) => h.endsWith("outlook.com") || h.endsWith("protection.outlook.com"))) {
      return { host: "outlook.office365.com", port: 993, provider: "outlook", guessed: false, unsupported: true, note: MS_NOTE };
    }
    if (hosts.some((h) => h.includes("zoho"))) {
      return { host: "imap.zoho.com", port: 993, provider: "zoho", guessed: false };
    }
    if (hosts.some((h) => h.includes("yahoodns"))) {
      return { host: "imap.mail.yahoo.com", port: 993, provider: "yahoo", guessed: false };
    }
    if (hosts.some((h) => h.includes("fastmail") || h.includes("messagingengine"))) {
      return { host: "imap.fastmail.com", port: 993, provider: "fastmail", guessed: false };
    }
  } catch {
    /* no MX or lookup failed — fall through to the guess */
  }

  return { host: `imap.${domain}`, port: 993, provider: "custom", guessed: true };
}

// Same fixed-category approach as describeSmtpFailure: never echo the driver error.
function describeImapFailure(err: unknown): string {
  const anyErr = err as { code?: string; authenticationFailed?: boolean; responseText?: string } | undefined;
  const code = String(anyErr?.code || "");
  const message = err instanceof Error ? err.message : String(err);
  const resp = String(anyErr?.responseText || "");

  if (anyErr?.authenticationFailed || code === "AUTHENTICATIONFAILED" || /auth|credential|password|invalid login|\[ALERT\]/i.test(message + resp)) {
    return "Sign-in failed. Use an App Password (not your normal password) and make sure IMAP is enabled for this mailbox.";
  }
  if (code === "ESOCKET" || /certificate|self.signed|tls|ssl/i.test(message)) {
    return "Secure connection failed — check the port (993 for SSL) and the server name.";
  }
  if (/timeout|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i.test(code + message)) {
    return "Could not reach the mail server — check the IMAP host and port.";
  }
  return "Could not connect to the mailbox. Check the server, port and app password.";
}

export interface ImapCredentialInput {
  email: string;
  host: string;
  port: number;
  username: string;
  password: string;
  useTls?: boolean;
}

function buildClient(cfg: { host: string; port: number; username: string; password: string; useTls?: boolean }, verifyOnly: boolean): ImapFlow {
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 993,
    auth: { user: cfg.username, pass: cfg.password },
    logger: false,
    verifyOnly,
    disableAutoIdle: true,
    tls: { rejectUnauthorized: cfg.useTls !== false },
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 45000,
    clientInfo: { name: "Inertia Leads", vendor: "Inertia Leads" },
  });
  // ImapFlow reports socket problems (e.g. "Socket timeout" on a connection left open after a
  // failed login) as an 'error' EVENT. With no listener, Node throws it as an uncaught exception
  // and the whole backend shuts down. Log it instead; the awaiting call still sees its own failure.
  client.on("error", (err: Error) => {
    logger.warn({ host: cfg.host, error: err?.message }, "IMAP connection error (handled)");
  });
  return client;
}

// Validate + open + authenticate, then disconnect. Returns a fixed-category error message.
export async function testImapConnection(cfg: ImapCredentialInput): Promise<{ success: boolean; error?: string }> {
  // Microsoft's IMAP endpoint rejects every password sign-in now; fail with the real reason
  // instead of a generic "sign-in failed" after a 15s attempt.
  if (/(^|\.)outlook\.office365\.com$|(^|\.)outlook\.com$|(^|\.)office365\.com$/i.test(cfg.host.trim())) {
    return { success: false, error: MS_NOTE };
  }
  const port = Number(cfg.port);
  if (!ALLOWED_IMAP_PORTS.includes(port)) {
    return { success: false, error: `Unsupported IMAP port. Use ${ALLOWED_IMAP_PORTS.join(" or ")}.` };
  }
  if (!(await isHostSafe(cfg.host))) {
    logger.warn({ host: cfg.host, port }, "Blocked IMAP connection to non-public host");
    return { success: false, error: "That mail server host is not reachable. Enter a public IMAP hostname (for example imap.gmail.com)." };
  }

  const client = buildClient({ ...cfg, port }, true);
  try {
    await client.connect(); // verifyOnly → logs out automatically after successful auth
    return { success: true };
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err), host: cfg.host, port }, "IMAP connection test failed");
    return { success: false, error: describeImapFailure(err) };
  } finally {
    try { client.close(); } catch { /* already closed */ }
  }
}

// =============================================
// Credential storage
// =============================================
export interface ImapCredentialRow {
  id: string;
  user_id: string;
  email: string;
  imap_host: string;
  imap_port: number;
  username: string;
  password_encrypted: string;
  use_tls: boolean;
  is_active: boolean;
  last_fetched_at: string | null;
  last_uid: number | null;
  last_error: string | null;
  created_at: string;
}

export async function addImapCredential(userId: string, cfg: ImapCredentialInput): Promise<{ id: string; email: string }> {
  const email = cfg.email.trim().toLowerCase();
  const { data: existing } = await supabase
    .from("imap_credentials")
    .select("id")
    .eq("user_id", userId)
    .eq("email", email)
    .single();

  const row = {
    imap_host: cfg.host.trim(),
    imap_port: Number(cfg.port),
    username: cfg.username.trim(),
    password_encrypted: encrypt(cfg.password),
    use_tls: cfg.useTls !== false,
    is_active: true,
    last_error: null,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    // Re-connect: replace credentials, keep the fetch cursor so old mail isn't re-ingested.
    const { error: updateErr } = await supabase.from("imap_credentials").update(row).eq("id", existing.id);
    if (updateErr) {
      logger.error({ userId, code: updateErr.code, error: updateErr.message, details: updateErr.details, hint: updateErr.hint }, "Failed to update IMAP credential");
      throw new Error("Failed to store inbox credentials");
    }
    return { id: existing.id, email };
  }

  const { data, error } = await supabase
    .from("imap_credentials")
    .insert({ user_id: userId, email, ...row })
    .select("id, email")
    .single();
  if (error || !data) {
    // Log the database's own reason (never the password) so a failed save is diagnosable.
    logger.error({ userId, code: error?.code, error: error?.message, details: error?.details, hint: error?.hint }, "Failed to insert IMAP credential");
    throw new Error("Failed to store inbox credentials");
  }
  return { id: data.id, email: data.email };
}

// Never returns the password.
export async function getImapCredentials(userId: string): Promise<Array<Omit<ImapCredentialRow, "password_encrypted" | "username">>> {
  const { data } = await supabase
    .from("imap_credentials")
    .select("id, user_id, email, imap_host, imap_port, use_tls, is_active, last_fetched_at, last_uid, last_error, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  return (data || []) as Array<Omit<ImapCredentialRow, "password_encrypted" | "username">>;
}

export async function removeImapCredential(userId: string, id: string): Promise<void> {
  const { data } = await supabase.from("imap_credentials").select("id").eq("id", id).eq("user_id", userId).single();
  if (!data) throw new Error("Inbox connection not found");
  await supabase.from("imap_credentials").delete().eq("id", id).eq("user_id", userId);
}

// =============================================
// Fetching
// =============================================
export interface FetchedMessage {
  uid: number;
  parsed: ParsedMail;
  raw: string;            // decoded source text (bounded) — used for bounce Message-ID scanning
  internalDate: Date | null;
  // Gmail only (X-GM-THRID via IMAP), converted to the same hex form the Gmail API returns
  // as threadId — which is what emails.thread_id stores for every Gmail-sent email.
  gmailThreadId: string | null;
}

// IMAP reports X-GM-THRID as a decimal uint64; the Gmail API reports the same number as hex.
export function gmailThreadIdToHex(decimal: string | undefined | null): string | null {
  if (!decimal || !/^\d+$/.test(decimal)) return null;
  try { return BigInt(decimal).toString(16); } catch { return null; }
}

const FIRST_FETCH_LOOKBACK_DAYS = 7;
const MAX_MESSAGES_PER_RUN = 150;   // per credential per cycle; the cursor advances so the rest follow next cycle
const MAX_SOURCE_BYTES = 600 * 1024; // bound memory; headers + text always fit

// Fetch INBOX messages newer than the stored cursor. First run looks back 7 days.
// Returns messages sorted by UID plus the highest UID seen (to persist as the new cursor).
export async function fetchNewMessages(cred: ImapCredentialRow): Promise<{ messages: FetchedMessage[]; maxUid: number | null }> {
  const password = decrypt(cred.password_encrypted);
  const client = buildClient(
    { host: cred.imap_host, port: cred.imap_port, username: cred.username, password, useTls: cred.use_tls },
    false
  );

  const messages: FetchedMessage[] = [];
  let maxUid: number | null = cred.last_uid ?? null;

  await client.connect();
  let lock: { release: () => void } | null = null;
  try {
    lock = await client.getMailboxLock("INBOX");

    let uids: number[] = [];
    if (cred.last_uid && cred.last_uid > 0) {
      // "n:*" returns at least the highest-UID message even when n > max UID (IMAP quirk),
      // so always filter uid > cursor afterwards.
      const found = await client.search({ uid: `${cred.last_uid + 1}:*` }, { uid: true });
      uids = Array.isArray(found) ? found.filter((u) => u > (cred.last_uid as number)) : [];
    } else {
      const since = new Date(Date.now() - FIRST_FETCH_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
      const found = await client.search({ since }, { uid: true });
      uids = Array.isArray(found) ? found : [];
    }

    uids.sort((a, b) => a - b);
    if (uids.length > MAX_MESSAGES_PER_RUN) uids = uids.slice(0, MAX_MESSAGES_PER_RUN);
    if (uids.length === 0) return { messages, maxUid };

    // Collect sources first; parse after the network loop so the connection stays short.
    const sources: Array<{ uid: number; source: Buffer; internalDate: Date | null; gmailThreadId: string | null }> = [];
    // threadId → X-GM-THRID on Gmail; other servers simply omit it.
    for await (const msg of client.fetch(uids, { uid: true, source: { maxLength: MAX_SOURCE_BYTES }, internalDate: true, threadId: true }, { uid: true })) {
      if (!msg.source) continue;
      const internalDate = msg.internalDate ? new Date(msg.internalDate) : null;
      sources.push({ uid: msg.uid, source: msg.source, internalDate, gmailThreadId: gmailThreadIdToHex(msg.threadId) });
      if (maxUid === null || msg.uid > maxUid) maxUid = msg.uid;
    }

    for (const s of sources) {
      try {
        const parsed = await simpleParser(s.source, { skipImageLinks: true, skipHtmlToText: false });
        messages.push({ uid: s.uid, parsed, raw: s.source.toString("utf8"), internalDate: s.internalDate, gmailThreadId: s.gmailThreadId });
      } catch (err) {
        logger.warn({ err, uid: s.uid, credentialId: cred.id }, "Failed to parse IMAP message");
      }
    }
    // Cursor = highest UID we were asked to process (even if some failed to parse) so a
    // poison message can't wedge the mailbox forever.
    const highestRequested = uids[uids.length - 1];
    if (maxUid === null || highestRequested > maxUid) maxUid = highestRequested;
  } finally {
    try { lock?.release(); } catch { /* ignore */ }
    try { await client.logout(); } catch { try { client.close(); } catch { /* ignore */ } }
  }

  messages.sort((a, b) => a.uid - b.uid);
  return { messages, maxUid };
}
