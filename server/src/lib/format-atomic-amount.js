/**
 * Human-readable decimal string from atomic (smallest-unit) integer string.
 * @param {string | number | bigint} raw
 * @param {number} decimals
 * @returns {string}
 */
export function formatAtomicAmountString(raw, decimals) {
  const dec = Math.min(Math.max(0, Math.floor(Number(decimals))), 36);
  try {
    const n = BigInt(String(raw).trim());
    if (dec === 0) return n.toString();
    const d = 10n ** BigInt(dec);
    const whole = n / d;
    const frac = n % d;
    const fs = frac.toString().padStart(dec, "0").replace(/0+$/, "");
    return fs ? `${whole}.${fs}` : whole.toString();
  } catch {
    return String(raw);
  }
}
