import { WithdrawalStatus } from "@prisma/client";
import { ACTIVE } from "../lib/active-row.js";
import { prisma } from "../lib/prisma.js";
import { formatAtomicAmountString } from "../lib/format-atomic-amount.js";
import { feeAmountFromPercent } from "../lib/merchant-fee-math.js";

/**
 * Pending/processing payouts grouped by asset. **Gross** is the full send volume; **net** matches gross. **Payout MDR**
 * is an **informational** reference fee on bucket gross for RP/admin (same rate as stored on payout rows; not deducted
 * from on-chain amount; deposit settlement % does not apply).
 *
 * @param {number} merchantId
 * @param {import("@prisma/client").MerchantGatewayEnv} environment
 * @param {{ payoutMdrPercent?: unknown }} feeRates Merchant payout MDR only.
 */
export async function buildPendingPayoutPreviewBuckets(merchantId, environment, feeRates) {
  const rows = await prisma.withdrawal.findMany({
    where: {
      merchantId,
      environment,
      status: { in: [WithdrawalStatus.pending, WithdrawalStatus.processing] },
      ...ACTIVE,
    },
    select: {
      chain: true,
      tokenSymbol: true,
      tokenDecimals: true,
      grossAmount: true,
      amount: true,
      id: true,
    },
  });

  const payoutMdrP = Number(feeRates?.payoutMdrPercent ?? 0);

  /** @type {Map<string, { chain: import("@prisma/client").Chain, token_symbol: string, token_decimals: number, gross: bigint, count: number }>} */
  const map = new Map();
  for (const r of rows) {
    const key = `${r.chain}|${r.tokenSymbol}|${r.tokenDecimals}`;
    const grossStr = (r.grossAmount ?? r.amount ?? "0").trim();
    let gross = 0n;
    try {
      gross = BigInt(grossStr || "0");
    } catch {
      continue;
    }
    const cur = map.get(key);
    if (!cur) {
      map.set(key, {
        chain: r.chain,
        token_symbol: r.tokenSymbol,
        token_decimals: r.tokenDecimals,
        gross,
        count: 1,
      });
    } else {
      cur.gross += gross;
      cur.count += 1;
    }
  }

  const buckets = [...map.values()].map((b) => {
    const dec = b.token_decimals ?? 6;
    const grossS = b.gross.toString();
    const grossBi = b.gross;
    const mdrS = feeAmountFromPercent(grossBi, payoutMdrP).toString();
    const stS = "0";
    const netS = grossS;
    return {
      chain: b.chain,
      token_symbol: b.token_symbol,
      token_decimals: dec,
      payout_row_count: b.count,
      gross_amount_atomic: grossS,
      gross_amount_decimal: formatAtomicAmountString(grossS, dec),
      net_amount_atomic: netS,
      net_amount_decimal: formatAtomicAmountString(netS, dec),
      mdr_amount_atomic: mdrS,
      mdr_amount_decimal: formatAtomicAmountString(mdrS, dec),
      settlement_fee_amount_atomic: stS,
      settlement_fee_amount_decimal: formatAtomicAmountString(stS, dec),
    };
  });

  buckets.sort((a, b) =>
    `${a.chain}${a.token_symbol}`.localeCompare(`${b.chain}${b.token_symbol}`),
  );
  return buckets;
}
