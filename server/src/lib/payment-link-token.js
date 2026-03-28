import crypto from "crypto";
import { env } from "../config/env.js";

/** How long the signed URL remains valid (access to the payment page). Independent of deposit scan TTL. */
const PAYMENT_LINK_TOKEN_TTL_SEC = 90 * 24 * 60 * 60;

/**
 * @param {string} buf
 * @returns {string}
 */
function b64urlEncode(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * @param {string} s
 * @returns {Buffer}
 */
function b64urlDecode(s) {
  const pad = (4 - (s.length % 4)) % 4;
  const b = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  return Buffer.from(b, "base64");
}

/**
 * @param {string} walletId
 * @param {string | null} [redirectUrl] — normalized absolute URL or null
 * @returns {string}
 */
export function createPaymentLinkToken(walletId, redirectUrl = null) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + PAYMENT_LINK_TOKEN_TTL_SEC;
  /** @type {{ w: string; exp: number; r?: string }} */
  const obj = { w: walletId, exp };
  if (redirectUrl) obj.r = redirectUrl;
  const payload = JSON.stringify(obj);
  const sig = crypto.createHmac("sha256", env.jwtSecret).update(payload).digest();
  return `${b64urlEncode(payload)}.${b64urlEncode(sig)}`;
}

/**
 * @param {string | undefined} token
 * @returns {{ walletId: string; redirectUrl: string | null } | null}
 */
export function verifyPaymentLinkToken(token) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const dot = token.indexOf(".");
  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);
  if (!payloadB64 || !sigB64) return null;
  let payloadStr;
  try {
    payloadStr = b64urlDecode(payloadB64).toString("utf8");
  } catch {
    return null;
  }
  const sigExpected = crypto.createHmac("sha256", env.jwtSecret).update(payloadStr).digest();
  let sigGot;
  try {
    sigGot = b64urlDecode(sigB64);
  } catch {
    return null;
  }
  if (sigGot.length !== sigExpected.length || !crypto.timingSafeEqual(sigGot, sigExpected)) {
    return null;
  }
  let data;
  try {
    data = JSON.parse(payloadStr);
  } catch {
    return null;
  }
  if (!data?.w || typeof data.w !== "string" || typeof data.exp !== "number") return null;
  const now = Math.floor(Date.now() / 1000);
  if (data.exp < now) return null;
  let redirectUrl = null;
  if (data.r != null && typeof data.r === "string" && data.r.trim()) {
    redirectUrl = data.r.trim();
  }
  return { walletId: data.w, redirectUrl };
}
