import { TxStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import {
  resolveAdminInternalId,
  resolveMerchantInternalId,
} from "../lib/entity-internal-id.js";
import {
  netStrictlyAboveMinSettlementHuman,
  parseHumanMinSettlementToAtomic,
  splitFeesSequentialFromGross,
} from "../lib/merchant-fee-math.js";
import { computeMerchantBalances } from "./merchant-balance.js";

/**
 * @param {{ amount: string }[]} rows
 * @returns {bigint}
 */
function sumTxAmounts(rows) {
  let g = 0n;
  for (const r of rows) {
    g += BigInt(String(r.amount).trim());
  }
  return g;
}

/**
 * @param {string | number} merchantId
 * @param {MerchantGatewayEnv} environment
 * @param {import("@prisma/client").Chain} chain
 * @param {string} tokenSymbol
 * @param {number} tokenDecimals
 * @param {number} periodDays
 * @param {import("@prisma/client").Prisma.TransactionClient} [txc]
 */
export async function loadUnsettledSuccessTransactions(
  merchantId,
  environment,
  chain,
  tokenSymbol,
  tokenDecimals,
  periodDays,
  txc = prisma,
) {
  const cutoff =
    Number.isInteger(periodDays) && periodDays > 0
      ? new Date(Date.now() - periodDays * 86_400_000)
      : null;

  return txc.transaction.findMany({
    where: {
      status: TxStatus.success,
      merchantSettlementId: null,
      chain,
      tokenSymbol,
      tokenDecimals,
      wallet: { merchantId, environment },
      ...(cutoff ? { createdAt: { lt: cutoff } } : {}),
    },
    select: { id: true, amount: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * @param {{ id: string, amount: string }[]} txRows
 * @param {number} mdrPercent
 * @param {number} settlementPercent
 * @param {string} minSettlementHumanRaw merchant field: token units, not atomic
 * @param {number} tokenDecimals
 */
export function previewBatchFromTxRows(
  txRows,
  mdrPercent,
  settlementPercent,
  minSettlementHumanRaw,
  tokenDecimals,
) {
  const gross = sumTxAmounts(txRows);
  const count = txRows.length;
  if (count === 0 || gross <= 0n) {
    return {
      transaction_count: 0,
      transaction_ids: [],
      gross_raw: "0",
      mdr_percent: mdrPercent,
      settlement_rate_percent: settlementPercent,
      mdr_amount_raw: "0",
      after_mdr_raw: "0",
      settlement_fee_raw: "0",
      net_to_merchant_raw: "0",
      meets_min: false,
    };
  }
  const fees = splitFeesSequentialFromGross(gross, mdrPercent, settlementPercent);
  const meetsMin = netStrictlyAboveMinSettlementHuman(
    fees.netAmount,
    minSettlementHumanRaw,
    tokenDecimals,
  );
  return {
    transaction_count: count,
    transaction_ids: txRows.map((t) => t.id),
    gross_raw: gross.toString(),
    mdr_percent: mdrPercent,
    settlement_rate_percent: settlementPercent,
    mdr_amount_raw: fees.mdrAmount.toString(),
    after_mdr_raw: fees.afterMdrAmount.toString(),
    settlement_fee_raw: fees.settlementFeeAmount.toString(),
    net_to_merchant_raw: fees.netAmount.toString(),
    meets_min: meetsMin,
  };
}

/**
 * @param {object} merchantRow
 * @param {number} merchantRow.id
 * @param {unknown} merchantRow.mdrPercent
 * @param {unknown} merchantRow.settlementRatePercent
 * @param {unknown} merchantRow.minSettlementAmount
 * @param {unknown} merchantRow.settlementPeriodDays
 */
export async function buildAllPendingPreviews(merchantId, environment, merchantRow) {
  const merchantInt = await resolveMerchantInternalId(merchantId);
  if (merchantInt == null) {
    return [];
  }
  merchantId = merchantInt;
  const periodDays = Number(merchantRow.settlementPeriodDays ?? 0);
  const mdrP = Number(merchantRow.mdrPercent);
  const stP = Number(merchantRow.settlementRatePercent);
  const minRaw = merchantRow.minSettlementAmount ?? "0";

  const cutoff =
    Number.isInteger(periodDays) && periodDays > 0
      ? new Date(Date.now() - periodDays * 86_400_000)
      : null;

  /** @type {{ chain: string, tokenSymbol: string, tokenDecimals: number }[]} */
  let groups;
  if (cutoff) {
    groups = await prisma.$queryRaw`
      SELECT t.chain::text AS chain, t.token_symbol AS "tokenSymbol", t.token_decimals AS "tokenDecimals"
      FROM transactions t
      INNER JOIN wallets w ON w.id = t.wallet_id
      WHERE t.status = 'success'::"TxStatus"
        AND t.merchant_settlement_id IS NULL
        AND w.merchant_id = ${merchantId}
        AND w.environment = ${environment}::"MerchantGatewayEnv"
        AND t.created_at < ${cutoff}
      GROUP BY t.chain, t.token_symbol, t.token_decimals
    `;
  } else {
    groups = await prisma.$queryRaw`
      SELECT t.chain::text AS chain, t.token_symbol AS "tokenSymbol", t.token_decimals AS "tokenDecimals"
      FROM transactions t
      INNER JOIN wallets w ON w.id = t.wallet_id
      WHERE t.status = 'success'::"TxStatus"
        AND t.merchant_settlement_id IS NULL
        AND w.merchant_id = ${merchantId}
        AND w.environment = ${environment}::"MerchantGatewayEnv"
      GROUP BY t.chain, t.token_symbol, t.token_decimals
    `;
  }

  const buckets = [];
  for (const g of groups) {
    const chain = /** @type {import("@prisma/client").Chain} */ (g.chain);
    const txs = await loadUnsettledSuccessTransactions(
      merchantId,
      environment,
      chain,
      g.tokenSymbol,
      g.tokenDecimals,
      periodDays,
    );
    const preview = previewBatchFromTxRows(txs, mdrP, stP, minRaw, g.tokenDecimals);
    const minHuman = String(minRaw).trim() || "0";
    const minAtomicParsed = parseHumanMinSettlementToAtomic(minHuman, g.tokenDecimals);
    const min_settlement_atomic = minAtomicParsed.ok ? minAtomicParsed.value.toString() : "0";
    buckets.push({
      chain: g.chain,
      token_symbol: g.tokenSymbol,
      token_decimals: g.tokenDecimals,
      min_settlement_amount: minHuman,
      min_settlement_atomic,
      ...preview,
    });
  }

  buckets.sort((a, b) =>
    `${a.chain}:${a.token_symbol}`.localeCompare(`${b.chain}:${b.token_symbol}`),
  );
  return buckets;
}

/**
 * @returns {Promise<import("@prisma/client").MerchantSettlement>}
 */
export async function executeBatchSettlement({
  merchantId,
  environment,
  chain,
  tokenSymbol,
  tokenDecimals,
  proofFileName,
  adminId,
}) {
  const merchantInt = await resolveMerchantInternalId(merchantId);
  if (merchantInt == null) {
    const e = new Error("merchant_not_found");
    /** @type {Error & { code?: string }} */ (e).code = "merchant_not_found";
    throw e;
  }
  merchantId = merchantInt;
  const createdByAdminId = adminId
    ? await resolveAdminInternalId(adminId)
    : null;

  const merchant = await prisma.merchant.findFirst({
    where: { id: merchantId, deletedAt: null },
    select: {
      id: true,
      mdrPercent: true,
      settlementRatePercent: true,
      minSettlementAmount: true,
      settlementPeriodDays: true,
    },
  });
  if (!merchant) {
    const e = new Error("merchant_not_found");
    /** @type {Error & { code?: string }} */ (e).code = "merchant_not_found";
    throw e;
  }

  const periodDays = Number(merchant.settlementPeriodDays ?? 0);
  const mdrP = Number(merchant.mdrPercent);
  const stP = Number(merchant.settlementRatePercent);

  return prisma.$transaction(async (txc) => {
    const txs = await loadUnsettledSuccessTransactions(
      merchantId,
      environment,
      chain,
      tokenSymbol,
      tokenDecimals,
      periodDays,
      txc,
    );
    if (txs.length === 0) {
      const e = new Error("no_eligible_transactions");
      /** @type {Error & { code?: string }} */ (e).code = "no_eligible_transactions";
      throw e;
    }

    const gross = sumTxAmounts(txs);
    let fees;
    try {
      fees = splitFeesSequentialFromGross(gross, mdrP, stP);
    } catch (err) {
      const e = new Error(String(err));
      /** @type {Error & { code?: string }} */ (e).code = "fee_calculation";
      throw e;
    }

    if (
      !netStrictlyAboveMinSettlementHuman(
        fees.netAmount,
        merchant.minSettlementAmount,
        tokenDecimals,
      )
    ) {
      const e = new Error("below_min_settlement_amount");
      /** @type {Error & { code?: string }} */ (e).code = "below_min_settlement_amount";
      throw e;
    }

    if (!proofFileName || !String(proofFileName).trim()) {
      const e = new Error("proof_required");
      /** @type {Error & { code?: string }} */ (e).code = "proof_required";
      throw e;
    }

    const balances = await computeMerchantBalances(
      merchantId,
      environment,
    );
    const chainStr = String(chain);
    const match = balances.find(
      (b) =>
        b.chain === chainStr &&
        b.token_symbol === tokenSymbol &&
        b.token_decimals === tokenDecimals,
    );
    if (!match || BigInt(match.balance_raw) < fees.netAmount) {
      const e = new Error("insufficient_balance");
      /** @type {Error & { code?: string }} */ (e).code = "insufficient_balance";
      throw e;
    }

    const row = await txc.merchantSettlement.create({
      data: {
        merchantId,
        environment,
        chain,
        tokenSymbol,
        tokenDecimals,
        grossAmount: gross.toString(),
        mdrPercent: merchant.mdrPercent,
        settlementRatePercent: merchant.settlementRatePercent,
        mdrAmount: fees.mdrAmount.toString(),
        settlementFeeAmount: fees.settlementFeeAmount.toString(),
        netAmount: fees.netAmount.toString(),
        proofFileName,
        createdByAdminId,
        transactionCount: txs.length,
      },
    });

    await txc.transaction.updateMany({
      where: { id: { in: txs.map((t) => t.id) } },
      data: { merchantSettlementId: row.id },
    });

    return row;
  });
}
