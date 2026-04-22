/**
 * Parse stored `wallets.cached_balance_atomic` (digits-only string from balance probe) for ordering.
 *
 * @param {string | null | undefined} raw
 * @returns {bigint}
 */
export function parseCachedBalanceAtomicToBigInt(raw) {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s || !/^[0-9]+$/.test(s)) return 0n;
  try {
    return BigInt(s);
  } catch {
    return 0n;
  }
}
