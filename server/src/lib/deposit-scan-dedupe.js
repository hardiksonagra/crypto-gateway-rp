import { logger } from "./logger.js";

/**
 * When several `wallets` rows share the same on-chain address + rail (data integrity bug),
 * the deposit worker must credit only one row — otherwise one TRC20 transfer creates N duplicate
 * `transactions` rows (e.g. merchant A and B both pointing at the same TRON address).
 *
 * @param {Array<{ id: number, merchantId?: number }>} targets
 * @param {Record<string, unknown>} ctx — e.g. chain, txHash, kind
 * @returns {(typeof targets)[0] | null}
 */
export function pickSingleDepositWallet(targets, ctx) {
  if (!targets || targets.length === 0) return null;
  if (targets.length === 1) return targets[0];
  const sorted = [...targets].sort((a, b) => Number(a.id) - Number(b.id));
  const chosen = sorted[0];
  const mids = sorted.map((w) => w.merchantId).filter((x) => x != null);
  logger.error("deposit_scan_ambiguous_wallet_rows", {
    event: "deposit_scan_ambiguous_wallet_rows",
    message:
      "Multiple wallet rows share the same chain address + rail; crediting lowest wallet id only. Investigate duplicate addresses across merchants.",
    chosen_wallet_id: chosen.id,
    omitted_wallet_ids: sorted.slice(1).map((w) => w.id),
    merchant_ids: [...new Set(mids)],
    row_count: sorted.length,
    ...ctx,
  });
  return chosen;
}
