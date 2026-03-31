/**
 * Fee lines from gross atomic amount and percent fees (both applied on the same gross).
 *
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

/**
 * MDR on gross, then settlement fee % on (gross − MDR). Used for batch settlement from transactions.
 *
 * @param {string | bigint} grossRawAtomic
 * @param {number} mdrPercent
 * @param {number} settlementRatePercent
 * @returns {{ mdrAmount: bigint, afterMdrAmount: bigint, settlementFeeAmount: bigint, netAmount: bigint }}
 */
export function splitFeesSequentialFromGross(
  grossRawAtomic,
  mdrPercent,
  settlementRatePercent,
) {
  const g = BigInt(String(grossRawAtomic).trim());
  if (g < 0n) {
    throw new Error("gross must be non-negative");
  }
  const mdr = feeAmountFromPercent(g, mdrPercent);
  const afterMdr = g - mdr;
  if (afterMdr < 0n) {
    throw new Error("mdr exceeds gross");
  }
  const settlement = feeAmountFromPercent(afterMdr, settlementRatePercent);
  const net = afterMdr - settlement;
  if (net < 0n) {
    throw new Error("settlement fee exceeds remainder");
  }
  return {
    mdrAmount: mdr,
    afterMdrAmount: afterMdr,
    settlementFeeAmount: settlement,
    netAmount: net,
  };
}

/**
 * @param {bigint} grossRaw
 * @param {number} percent 0–100; uses basis points (percent × 100, rounded).
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
 * @param {number} percent
 * @returns {boolean}
 */
export function isValidFeePercent(percent) {
  const p = Number(percent);
  return Number.isFinite(p) && p >= 0 && p <= 100;
}

/**
 * @param {unknown} v
 * @returns {number | null}
 */
export function parseFeePercent(v) {
  if (v === undefined || v === null || v === "") return 0;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isFinite(n)) return null;
  return n;
}

/**
 * Whole days to hold new deposits before they count toward settlement (0 = off).
 *
 * @param {unknown} v
 * @returns {number | null}
 */
export function parseSettlementPeriodDays(v) {
  if (v === undefined || v === null || v === "") return 0;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (n < 0 || n > 3650) return null;
  return n;
}

export function parseNonNegativeAtomicString(v) {
  const raw = String(v ?? "").trim() || "0";
  try {
    const value = BigInt(raw);
    if (value < 0n) {
      return { ok: false, error: "must be non-negative" };
    }
    return { ok: true, raw, value };
  } catch {
    return { ok: false, error: "invalid integer" };
  }
}

/**
 * Merchant `min_settlement_amount` is stored as a **human token amount** (e.g. `3000` = three thousand
 * tokens, `0.002` = two thousandths), not chain smallest units. Convert to atomic using `tokenDecimals`.
 *
 * @param {unknown} humanStr
 * @param {number} tokenDecimals 0–36
 * @returns {{ ok: true, value: bigint } | { ok: false, error: string }}
 */
export function parseHumanMinSettlementToAtomic(humanStr, tokenDecimals) {
  const dec = Math.min(36, Math.max(0, Math.floor(Number(tokenDecimals))));
  let s = String(humanStr ?? "").trim();
  if (s === "" || s === "." || /^0\.0*$/.test(s)) {
    return { ok: true, value: 0n };
  }
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(s)) {
    return { ok: false, error: "invalid human amount" };
  }
  const dot = s.indexOf(".");
  const wStr = dot === -1 ? s : s.slice(0, dot);
  const fStr = dot === -1 ? "" : s.slice(dot + 1);
  if (wStr.length > 0 && !/^\d+$/.test(wStr)) {
    return { ok: false, error: "invalid whole part" };
  }
  if (!/^\d*$/.test(fStr)) {
    return { ok: false, error: "invalid fraction" };
  }
  const fTrunc = fStr.slice(0, dec);
  const wholeTrim = wStr === "" ? "0" : wStr.replace(/^0+(?=\d)/, "") || "0";
  const whole = BigInt(wholeTrim);
  if (dec === 0) {
    if (fStr.length > 0 && !/^0+$/.test(fStr)) {
      return { ok: false, error: "token has 0 decimals" };
    }
    return { ok: true, value: whole };
  }
  const fracPadded = fTrunc.padEnd(dec, "0");
  const fracBn = BigInt(fracPadded || "0");
  const mult = 10n ** BigInt(dec);
  return { ok: true, value: whole * mult + fracBn };
}

/**
 * Validate/normalize merchant min settlement string for DB (human token units).
 *
 * @param {unknown} input
 * @returns {{ ok: true, raw: string } | { ok: false, error: string }}
 */
export function validateAndNormalizeHumanMinSettlement(input) {
  const s = String(input ?? "").trim();
  if (!s || s === "0" || /^0\.0*$/.test(s)) {
    return { ok: true, raw: "0" };
  }
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(s)) {
    return {
      ok: false,
      error:
        "Minimum settlement must be a non-negative token amount (e.g. 3000 or 0.002), not raw chain units.",
    };
  }
  const dot = s.indexOf(".");
  const fStr = dot === -1 ? "" : s.slice(dot + 1);
  if (fStr.length > 36) {
    return { ok: false, error: "Too many decimal places (max 36)." };
  }
  if (s.length > 80) {
    return { ok: false, error: "Value too long." };
  }
  return { ok: true, raw: s };
}

/**
 * Batch net (atomic) vs merchant minimum stored as **human token amount**; compared per-asset using decimals.
 * If min is 0: requires net &gt; 0. If min &gt; 0: requires net **&gt;** minAtomic (strict).
 *
 * @param {bigint} netAmountAtomic
 * @param {unknown} minSettlementHumanRaw
 * @param {number} tokenDecimals
 * @returns {boolean}
 */
export function netStrictlyAboveMinSettlementHuman(
  netAmountAtomic,
  minSettlementHumanRaw,
  tokenDecimals,
) {
  const t = String(minSettlementHumanRaw ?? "").trim();
  if (!t || t === "0" || /^0\.0*$/.test(t)) {
    return netAmountAtomic > 0n;
  }
  const p = parseHumanMinSettlementToAtomic(t, tokenDecimals);
  if (!p.ok || p.value === 0n) {
    return netAmountAtomic > 0n;
  }
  return netAmountAtomic > p.value;
}
