import { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import { formatAtomicAmountString } from "./format-atomic-amount.js";

/**
 * True when Postgres reports `wallet_assignment_events` is missing (migrate not applied yet).
 * @param {unknown} e
 * @returns {boolean}
 */
export function isWalletAssignmentTableMissingError(e) {
  const err = /** @type {{ code?: string, message?: string, meta?: { code?: string, message?: string } }} */ (
    e && typeof e === "object" ? e : {}
  );
  const blob = `${String(err.message ?? "")} ${String(err.meta?.message ?? "")}`;
  if (!blob.includes("wallet_assignment_events")) return false;
  return (
    err.code === "P2010" ||
    err.code === "P2021" ||
    err.meta?.code === "42P01"
  );
}

/**
 * @param {string[]} userIds
 * @returns {Promise<Map<string, { event_count: number, distinct_wallets: number }>>}
 */
export async function batchUserAssignmentStats(userIds) {
  /** @type {Map<string, { event_count: number, distinct_wallets: number }>} */
  const out = new Map();
  const unique = [...new Set(userIds.filter(Boolean))];
  if (!unique.length) return out;

  try {
    const rows = await prisma.$queryRaw`
      SELECT
        e.user_id AS "userId",
        COUNT(*)::int AS "event_count",
        COUNT(DISTINCT e.wallet_id)::int AS "distinct_wallets"
      FROM "wallet_assignment_events" e
      WHERE e.user_id IN (${Prisma.join(unique)})
      GROUP BY e.user_id
    `;

    for (const r of /** @type {{ userId: string, event_count: number, distinct_wallets: number }[]} */ (
      rows
    )) {
      out.set(r.userId, {
        event_count: r.event_count,
        distinct_wallets: r.distinct_wallets,
      });
    }
  } catch (e) {
    if (!isWalletAssignmentTableMissingError(e)) throw e;
  }
  return out;
}

/**
 * @param {string[]} userIds
 * @returns {Promise<Map<string, { total_tx: number, success_tx: number }>>}
 */
export async function batchUserPayerTxStats(userIds) {
  /** @type {Map<string, { total_tx: number, success_tx: number }>} */
  const out = new Map();
  const unique = [...new Set(userIds.filter(Boolean))];
  if (!unique.length) return out;

  const rows = await prisma.$queryRaw`
    SELECT
      t.payer_user_id AS "userId",
      COUNT(*)::int AS "total_tx",
      COUNT(*) FILTER (WHERE t.status = 'success')::int AS "success_tx"
    FROM "transactions" t
    WHERE t.payer_user_id IN (${Prisma.join(unique)})
    GROUP BY t.payer_user_id
  `;

  for (const r of /** @type {{ userId: string, total_tx: number, success_tx: number }[]} */ (
    rows
  )) {
    if (r.userId) {
      out.set(r.userId, { total_tx: r.total_tx, success_tx: r.success_tx });
    }
  }
  return out;
}

/**
 * @param {string} userId
 * @param {number} limit
 */
export async function loadUserAssignmentHistory(userId, limit) {
  const capped = Math.min(Math.max(1, Math.floor(limit)), 500);
  try {
    const rows = await prisma.walletAssignmentEvent.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: capped,
      include: {
        wallet: {
          select: {
            id: true,
            address: true,
            chain: true,
            currency: true,
            network: true,
          },
        },
      },
    });
    return rows.map((e) => ({
      id: e.id,
      at: e.createdAt.toISOString(),
      source: e.source,
      wallet_id: e.walletId,
      wallet_address: e.wallet.address,
      chain: e.wallet.chain,
      currency: e.wallet.currency,
      network: e.wallet.network,
    }));
  } catch (e) {
    if (isWalletAssignmentTableMissingError(e)) return [];
    throw e;
  }
}

/**
 * @param {string} userId
 * @param {number} limit
 */
export async function loadUserPayerDepositHistory(userId, limit) {
  const capped = Math.min(Math.max(1, Math.floor(limit)), 500);
  const [countRows, rows] = await Promise.all([
    prisma.$queryRaw`
      SELECT
        COUNT(*)::int AS "total_all",
        COUNT(*) FILTER (WHERE t.status = 'success')::int AS "success_all"
      FROM "transactions" t
      WHERE t.payer_user_id = ${userId}
    `,
    prisma.transaction.findMany({
      where: { payerUserId: userId },
      orderBy: { createdAt: "desc" },
      take: capped,
      include: {
        wallet: {
          select: {
            id: true,
            address: true,
            currency: true,
            network: true,
            chain: true,
          },
        },
      },
    }),
  ]);

  const agg = /** @type {{ total_all: number, success_all: number }[]} */ (
    countRows
  )[0] ?? { total_all: 0, success_all: 0 };
  const totalAll = agg.total_all;
  const successAll = agg.success_all;

  const events = rows.map((t) => ({
    id: t.id,
    at: t.createdAt.toISOString(),
    status: t.status,
    tx_hash: t.txHash,
    amount_atomic: t.amount,
    amount_decimal: formatAtomicAmountString(t.amount, t.tokenDecimals),
    token_symbol: t.tokenSymbol,
    token_decimals: t.tokenDecimals,
    wallet_id: t.walletId,
    wallet_address: t.wallet.address,
    currency: t.wallet.currency,
    network: t.wallet.network,
    chain: t.chain,
  }));

  return {
    summary: {
      total_transactions: totalAll,
      successful_deposits: successAll,
      rows_in_response: events.length,
    },
    events,
  };
}
