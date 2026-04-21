/** Max length for optional `redirect_url` on `deposit-address` (merchant return URL). */
const MAX_REDIRECT_URL_LEN = 1024;

/**
 * Validates and normalizes an optional HTTPS return URL from `deposit-address`.
 * Only `http:` and `https:` are allowed.
 *
 * @param {unknown} raw
 * @returns {string | null}
 */
export function normalizeGatewayRedirectUrl(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (s.length > MAX_REDIRECT_URL_LEN) return null;
  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  const p = u.protocol.toLowerCase();
  if (p !== "http:" && p !== "https:") return null;
  return u.toString();
}
