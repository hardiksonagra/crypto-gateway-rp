/**
 * Coerce JSON/API wallet primary key to a positive integer for Prisma `Wallet.id`.
 * @param {unknown} walletId
 * @returns {number | null}
 */
export function parseWalletDbId(walletId) {
  if (typeof walletId === "number" && Number.isInteger(walletId)) {
    return walletId > 0 ? walletId : null;
  }
  const s = String(walletId ?? "").trim();
  if (!/^\d+$/.test(s)) return null;
  const n = parseInt(s, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}
