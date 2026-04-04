import { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import { formatAtomicAmountString } from "./format-atomic-amount.js";

/**
 * PostgreSQL `numeric` sum rendered as text → bigint (atomic integer strings).
 * @param {string | null | undefined} s
 * @returns {bigint}
 */
function bigIntFromPgNumericText(s) {
  const t = String(s ?? "0").trim();
  if (!t || t === "0") return 0n;
  const i = t.includes(".") ? t.split(".")[0] : t;
  if (i === "" || i === "-") return 0n;
  return BigInt(i);
}

/**
 * Per-wallet aggregates from `transactions` (on-chain rows we recorded). Does not include
 * API assignments that never received a deposit.
 *
 * @param {number[]} walletIds
 * @returns {Promise<Map<number, { total_tx: number, success_tx: number, distinct_payers: number, success_received_display: string | null }>>}
 */
export async function aggregateWalletTxStats(walletIds) {
  /** @type {Map<number, { total_tx: number, success_tx: number, distinct_payers: number, success_received_display: string | null }>} */
  const out = new Map();
  if (!walletIds.length) return out;
  const unique = [...new Set(walletIds.filter((id) => id != null && Number.isFinite(Number(id))))].map(
    (id) => Number(id),
  );
  if (!unique.length) return out;

  const [rows, sumRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT
        t.wallet_id AS "walletId",
        COUNT(*)::int AS "totalTx",
        COUNT(*) FILTER (WHERE t.status = 'success')::int AS "successTx",
        COUNT(DISTINCT t.payer_user_id) FILTER (WHERE t.payer_user_id IS NOT NULL)::int AS "distinctPayers"
      FROM "transactions" t
      WHERE t.wallet_id IN (${Prisma.join(unique)})
      GROUP BY t.wallet_id
    `,
    prisma.$queryRaw`
      SELECT
        t.wallet_id AS "walletId",
        t.token_symbol AS "tokenSymbol",
        t.token_decimals AS "tokenDecimals",
        SUM(t.amount::numeric)::text AS "sumAmount"
      FROM "transactions" t
      WHERE t.wallet_id IN (${Prisma.join(unique)})
        AND t.status = 'success'
      GROUP BY t.wallet_id, t.token_symbol, t.token_decimals
    `,
  ]);

  /** @type {Map<number, string[]>} */
  const partsByWallet = new Map();
  for (const r of /** @type {{ walletId: number, tokenSymbol: string, tokenDecimals: number, sumAmount: string }[]} */ (
    sumRows
  )) {
    const wid = Number(r.walletId);
    const atomic = bigIntFromPgNumericText(r.sumAmount);
    if (atomic === 0n) continue;
    const part = `${formatAtomicAmountString(atomic, Number(r.tokenDecimals))} ${r.tokenSymbol}`;
    const arr = partsByWallet.get(wid) ?? [];
    arr.push(part);
    partsByWallet.set(wid, arr);
  }

  for (const r of /** @type {{ walletId: number, totalTx: number, successTx: number, distinctPayers: number }[]} */ (
    rows
  )) {
    const wid = Number(r.walletId);
    const parts = partsByWallet.get(wid);
    out.set(wid, {
      total_tx: r.totalTx,
      success_tx: r.successTx,
      distinct_payers: r.distinctPayers,
      success_received_display: parts?.length ? parts.join(" · ") : null,
    });
  }

  for (const wid of unique) {
    if (out.has(wid)) continue;
    const parts = partsByWallet.get(wid);
    out.set(wid, {
      total_tx: 0,
      success_tx: 0,
      distinct_payers: 0,
      success_received_display: parts?.length ? parts.join(" · ") : null,
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
