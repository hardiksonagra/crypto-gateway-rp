import { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";

/**
 * Per-wallet aggregates from `transactions` (on-chain rows we recorded). Does not include
 * API assignments that never received a deposit.
 *
 * @param {string[]} walletIds
 * @returns {Promise<Map<string, { total_tx: number, success_tx: number, distinct_payers: number }>>}
 */
export async function aggregateWalletTxStats(walletIds) {
  /** @type {Map<string, { total_tx: number, success_tx: number, distinct_payers: number }>} */
  const out = new Map();
  if (!walletIds.length) return out;
  const unique = [...new Set(walletIds.filter(Boolean))];
  if (!unique.length) return out;

  const rows = await prisma.$queryRaw`
    SELECT
      t.wallet_id AS "wallet_id",
      COUNT(*)::int AS "total_tx",
      COUNT(*) FILTER (WHERE t.status = 'success')::int AS "success_tx",
      COUNT(DISTINCT t.payer_user_id) FILTER (WHERE t.payer_user_id IS NOT NULL)::int AS "distinct_payers"
    FROM "transactions" t
    WHERE t.wallet_id IN (${Prisma.join(unique)})
    GROUP BY t.wallet_id
  `;

  for (const r of /** @type {{ wallet_id: string, total_tx: number, success_tx: number, distinct_payers: number }[]} */ (
    rows
  )) {
    out.set(r.wallet_id, {
      total_tx: r.total_tx,
      success_tx: r.success_tx,
      distinct_payers: r.distinct_payers,
    });
  }
  return out;
}

/**
 * @param {string} walletId
 * @param {number} limit
 * @returns {Promise<{
 *   summary: { total_tx: number, success_tx: number, distinct_payers: number },
 *   events: Array<{
 *     id: string,
 *     created_at: string,
 *     amount: string,
 *     token_symbol: string,
 *     token_decimals: number,
 *     status: string,
 *     tx_hash: string,
 *     user_id: string | null,
 *     external_user_id: string | null,
 *   }>
 * }>}
 */
export async function loadWalletDepositActivity(walletId, limit) {
  const capped = Math.min(Math.max(1, Math.floor(limit)), 500);
  const [aggRows, txs] = await Promise.all([
    prisma.$queryRaw`
      SELECT
        COUNT(*)::int AS "total_tx",
        COUNT(*) FILTER (WHERE status = 'success')::int AS "success_tx",
        COUNT(DISTINCT payer_user_id) FILTER (WHERE payer_user_id IS NOT NULL)::int AS "distinct_payers"
      FROM "transactions"
      WHERE wallet_id = ${walletId}
    `,
    prisma.transaction.findMany({
      where: { walletId },
      orderBy: { createdAt: "desc" },
      take: capped,
      select: {
        id: true,
        createdAt: true,
        amount: true,
        tokenSymbol: true,
        tokenDecimals: true,
        status: true,
        txHash: true,
        payerUserId: true,
        payerUser: { select: { externalUserId: true } },
      },
    }),
  ]);

  const agg = /** @type {{ total_tx: number, success_tx: number, distinct_payers: number }[]} */ (
    aggRows
  )[0] ?? {
    total_tx: 0,
    success_tx: 0,
    distinct_payers: 0,
  };

  return {
    summary: {
      total_tx: agg.total_tx,
      success_tx: agg.success_tx,
      distinct_payers: agg.distinct_payers,
    },
    events: txs.map((t) => ({
      id: t.id,
      created_at: t.createdAt.toISOString(),
      amount: t.amount,
      token_symbol: t.tokenSymbol,
      token_decimals: t.tokenDecimals,
      status: t.status,
      tx_hash: t.txHash,
      user_id: t.payerUserId,
      external_user_id: t.payerUser?.externalUserId ?? null,
    })),
  };
}
