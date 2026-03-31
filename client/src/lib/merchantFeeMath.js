/**
 * @param {bigint} grossRaw
 * @param {number} percent
 * @returns {bigint}
 */
export function feeAmountFromPercent(grossRaw, percent) {
  const p = Number(percent);
  if (!Number.isFinite(p) || p <= 0) return 0n;
  if (p >= 100) return grossRaw;
  const bps = Math.round(p * 100);
  if (bps <= 0) return 0n;
  if (bps >= 10_000) return grossRaw;
  return (grossRaw * BigInt(bps)) / 10000n;
}

/**
 * @param {string | bigint} grossRawAtomic
 * @param {number} mdrPercent
 * @param {number} settlementRatePercent
 * @returns {{ mdrAmount: bigint, settlementFeeAmount: bigint, netAmount: bigint }}
 */
export function splitFeesFromGross(grossRawAtomic, mdrPercent, settlementRatePercent) {
  const g = BigInt(String(grossRawAtomic).trim());
  if (g < 0n) {
    throw new Error("gross must be non-negative");
  }
  const mdr = feeAmountFromPercent(g, mdrPercent);
  const settlement = feeAmountFromPercent(g, settlementRatePercent);
  const net = g - mdr - settlement;
  if (net < 0n) {
    throw new Error("fees exceed gross");
  }
  return { mdrAmount: mdr, settlementFeeAmount: settlement, netAmount: net };
}
