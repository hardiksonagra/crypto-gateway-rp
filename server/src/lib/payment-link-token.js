import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

/**
 * Signed token for hosted checkout (`/pay/:token`). Verified only by the API;
 * payload is opaque to clients.
 *
 * @param {string} walletIdString — internal `wallets.id` as string
 * @param {string | null | undefined} redirectUrl — optional merchant return URL
 * @param {string | null | undefined} depositSessionKey — checkout session key (may be null)
 * @returns {string} JWT compact string, or empty when `walletIdString` is missing
 */
export function createPaymentLinkToken(
  walletIdString,
  redirectUrl,
  depositSessionKey,
) {
  const w = String(walletIdString ?? "").trim();
  if (!w) return "";
  const sk =
    typeof depositSessionKey === "string" && depositSessionKey.trim()
      ? depositSessionKey.trim()
      : null;
  const ru =
    typeof redirectUrl === "string" && redirectUrl.trim()
      ? redirectUrl.trim()
      : null;
  /** @type {Record<string, unknown>} */
  const payload = { w, sk, ru };
  return jwt.sign(payload, env.jwtSecret, {
    algorithm: "HS256",
    expiresIn: "30d",
  });
}

/**
 * @param {string | null | undefined} token
 * @returns {{
 *   walletId: string,
 *   depositSessionKey: string | null,
 *   redirectUrl: string | null,
 *   linkIssuedAt: number | null,
 * } | null}
 */
export function verifyPaymentLinkToken(token) {
  if (token == null || typeof token !== "string") return null;
  const raw = token.trim();
  if (!raw) return null;
  try {
    const d = jwt.verify(raw, env.jwtSecret, { algorithms: ["HS256"] });
    if (!d || typeof d !== "object" || Array.isArray(d)) return null;
    const w = String(/** @type {Record<string, unknown>} */ (d).w ?? "").trim();
    if (!w) return null;
    const skRaw = /** @type {Record<string, unknown>} */ (d).sk;
    const ruRaw = /** @type {Record<string, unknown>} */ (d).ru;
    const iatRaw = /** @type {Record<string, unknown>} */ (d).iat;
    return {
      walletId: w,
      depositSessionKey:
        typeof skRaw === "string" && skRaw.trim() ? skRaw.trim() : null,
      redirectUrl:
        typeof ruRaw === "string" && ruRaw.trim() ? ruRaw.trim() : null,
      linkIssuedAt: typeof iatRaw === "number" ? iatRaw : null,
    };
  } catch {
    return null;
  }
}
