// =============================================
// Email header formatting
// =============================================
// Outbound emails are sent as PLAIN TEXT (no HTML, no unsubscribe link, no
// List-Unsubscribe header) so they read like a personal 1:1 message and land in
// the Primary inbox instead of the Promotions tab. This module now only handles
// RFC 2047 encoding of header values.

// Encode a header value as an RFC 2047 "encoded-word" when it contains non-ASCII.
// Email headers are ASCII-only; raw UTF-8 (em-dash, smart quotes, emoji) placed
// directly into a header is misread by clients as Latin-1 and shows up as mojibake
// (e.g. "—" → "Ã¢Â€Â""). This wraps such values as =?UTF-8?B?<base64>?= so they
// render correctly everywhere. Pure-ASCII values are returned unchanged.
// Long values are split into multiple encoded-words on character boundaries
// (never mid-multibyte-char), each kept within the 75-char encoded-word limit,
// and joined with header folding whitespace.
export function encodeMimeHeader(value: string): string {
  // Pure printable ASCII → no encoding needed.
  if (/^[\x20-\x7E]*$/.test(value)) return value;

  const prefix = "=?UTF-8?B?";
  const suffix = "?=";
  // RFC 2047: an encoded-word must be <= 75 chars total. Budget the base64 payload
  // to fit, keeping it a multiple of 4 (base64 encodes 3 input bytes → 4 chars).
  const maxB64 = 75 - prefix.length - suffix.length;
  const maxBytesPerWord = Math.floor((maxB64 - (maxB64 % 4)) / 4) * 3;

  const words: string[] = [];
  let chunk: number[] = [];
  // Iterate by code point so a multibyte character is never split across words.
  for (const ch of value) {
    const bytes = [...Buffer.from(ch, "utf8")];
    if (chunk.length > 0 && chunk.length + bytes.length > maxBytesPerWord) {
      words.push(prefix + Buffer.from(chunk).toString("base64") + suffix);
      chunk = [];
    }
    chunk.push(...bytes);
  }
  if (chunk.length > 0) {
    words.push(prefix + Buffer.from(chunk).toString("base64") + suffix);
  }
  // Adjacent encoded-words separated by folding whitespace (CRLF + space) are
  // concatenated by the client — this also keeps long headers within line limits.
  return words.join("\r\n ");
}
