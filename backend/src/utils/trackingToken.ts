import crypto from "crypto";

// =============================================
// Tracking tokens (HMAC-signed, stateless, compact)
// =============================================
// Embedded in every outgoing email as the open pixel URL and the click-redirect URLs,
// so they must be (a) unguessable and (b) SHORT — a 150-char URL in a plain-looking
// cold email reads as spam. Format:
//
//   <emailId as 32 hex chars><link index as 2 hex chars>.<HMAC-SHA256 truncated to 16 bytes, base64url>
//
// ≈ 57 characters. The kind ("o" open / "c" click) is part of the signed payload so an
// open token can never be replayed against the click endpoint or vice-versa.
// Reuses TOKEN_ENCRYPTION_KEY as the signing secret (same pattern as unsubscribe / OAuth state).

export type TrackingKind = "o" | "c";

const SIG_BYTES = 16;

function getSigningKey(): Buffer {
  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (!key || key.length !== 64) throw new Error("TOKEN_ENCRYPTION_KEY required for tracking token signing");
  return Buffer.from(key, "hex");
}

function sign(kind: TrackingKind, payload: string): string {
  return crypto
    .createHmac("sha256", getSigningKey())
    .update(`${kind}:${payload}`)
    .digest()
    .subarray(0, SIG_BYTES)
    .toString("base64url");
}

function uuidToHex(id: string): string | null {
  const hex = id.replace(/-/g, "").toLowerCase();
  return /^[0-9a-f]{32}$/.test(hex) ? hex : null;
}

function hexToUuid(hex: string): string {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// index: 0 for opens; the link's ordinal position in the body (0-255) for clicks.
export function signTrackingToken(kind: TrackingKind, emailId: string, index = 0): string | null {
  const hex = uuidToHex(emailId);
  if (!hex) return null;
  const idx = Math.max(0, Math.min(255, index)).toString(16).padStart(2, "0");
  const payload = `${hex}${idx}`;
  return `${payload}.${sign(kind, payload)}`;
}

// Returns null on any tampering / malformed input. Never throws.
export function verifyTrackingToken(kind: TrackingKind, token: string): { emailId: string; index: number } | null {
  try {
    if (!token || token.length > 80) return null;
    const dot = token.indexOf(".");
    if (dot !== 34) return null; // 32 hex + 2 hex
    const payload = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    if (!/^[0-9a-f]{34}$/.test(payload)) return null;
    const expected = sign(kind, payload);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    return { emailId: hexToUuid(payload.slice(0, 32)), index: parseInt(payload.slice(32), 16) };
  } catch {
    return null;
  }
}
