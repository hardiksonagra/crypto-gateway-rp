/**
 * Optional `amount` on `POST /api/v1/gateway/deposit-address` (smallest-unit integer string, or decimal).
 */

/**
 * Token decimals for supported gateway deposit rails (atomic string math).
 * @param {string} currency
 * @param {string} network
 * @returns {number | null}
 */
export function tokenDecimalsForGatewayRail(currency, network) {
  const c = String(currency ?? "")
    .trim()
    .toUpperCase();
  const n = String(network ?? "")
    .trim()
    .toUpperCase();
  if (c === "USDT" && (n === "TRC20" || n === "ERC20" || n === "BEP20")) {
    return 6;
  }
  return null;
}

/**
 * @param {string} whole
 * @param {string} frac
 * @param {number} tokenDecimals
 * @returns {bigint}
 */
function decimalPartsToAtomic(whole, frac, tokenDecimals) {
  const dec = Math.min(Math.max(0, Math.floor(tokenDecimals)), 36);
  const w = BigInt(whole === "" || whole === "-" ? "0" : whole);
  const fRaw = (frac || "").replace(/\D/g, "").slice(0, dec);
  const f = BigInt((fRaw + "0".repeat(dec)).slice(0, dec) || "0");
  const scale = 10n ** BigInt(dec);
  return w * scale + f;
}

/**
 * Optional gateway `amount`: digits-only = atomic smallest units; contains `.` = decimal token amount.
 *
 * @param {unknown} raw
 * @param {number} tokenDecimals
 * @returns {{ ok: true, atomic: string | null } | { ok: false, error: string }}
 */
export function parseOptionalGatewayDepositAmount(raw, tokenDecimals) {
  if (raw == null || raw === "") return { ok: true, atomic: null };
  const s = String(raw).trim();
  if (!s) return { ok: true, atomic: null };
  const dec = Math.min(Math.max(0, Math.floor(tokenDecimals)), 36);
  if (s.length > 80) return { ok: false, error: "amount_too_long" };

  if (!s.includes(".")) {
    if (!/^\d+$/.test(s)) return { ok: false, error: "amount_invalid" };
    try {
      const n = BigInt(s);
      if (n <= 0n) return { ok: false, error: "amount_must_be_positive" };
      const maxReasonable = 10n ** 24n;
      if (n > maxReasonable) return { ok: false, error: "amount_too_large" };
      return { ok: true, atomic: s };
    } catch {
      return { ok: false, error: "amount_invalid" };
    }
  }

  const dot = s.indexOf(".");
  const wPart = s.slice(0, dot);
  const fPart = s.slice(dot + 1);
  if (s.slice(dot + 1).includes(".")) return { ok: false, error: "amount_invalid" };
  if (!/^\d*$/.test(wPart) || !/^\d*$/.test(fPart))
    return { ok: false, error: "amount_invalid" };
  const whole = wPart === "" ? "0" : wPart;
  const frac = fPart;
  if (whole === "0" && (!frac || /^0*$/.test(frac)))
    return { ok: false, error: "amount_must_be_positive" };
  try {
    const n = decimalPartsToAtomic(whole, frac, dec);
    if (n <= 0n) return { ok: false, error: "amount_must_be_positive" };
    const maxReasonable = 10n ** 24n;
    if (n > maxReasonable) return { ok: false, error: "amount_too_large" };
    return { ok: true, atomic: n.toString() };
  } catch {
    return { ok: false, error: "amount_invalid" };
  }
}

/** One smallest-unit slack when comparing received vs expected (rounding / dust). */
export const UNDERPAY_TOLERANCE_ATOMIC = 1n;
