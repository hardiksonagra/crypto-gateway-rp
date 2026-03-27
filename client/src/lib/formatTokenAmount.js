/**
 * @param {string | number | bigint} raw — integer string, smallest units
 * @param {number} decimals
 * @returns {string}
 */
export function formatTokenAmount(raw, decimals) {
  const dec = Math.min(Math.max(0, Math.floor(Number(decimals))), 36);
  try {
    const n = BigInt(String(raw).trim());
    if (dec === 0) return n.toString();
    const d = BigInt(10) ** BigInt(dec);
    const whole = n / d;
    const frac = n % d;
    const fs = frac.toString().padStart(dec, "0").replace(/0+$/, "");
    return fs ? `${whole}.${fs}` : whole.toString();
  } catch {
    return String(raw);
  }
}
