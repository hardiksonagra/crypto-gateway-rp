import { MerchantGatewayEnv } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

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
 * @param {string} merchantId
 * @param {import("@prisma/client").MerchantGatewayEnv} [environment]
 */
export async function computeMerchantBalances(
  merchantId,
  environment = MerchantGatewayEnv.live,
) {
  const inboundRows = await prisma.$queryRaw`
    SELECT
      t.chain::text AS chain,
      t.token_symbol AS "tokenSymbol",
      t.token_decimals AS "tokenDecimals",
      SUM(t.amount::numeric)::text AS "sumAmount"
    FROM "transactions" t
    INNER JOIN "wallets" w ON w.id = t.wallet_id
    WHERE t.status = 'success'
      AND w.merchant_id = ${merchantId}
      AND w.environment = ${environment}::"MerchantGatewayEnv"
    GROUP BY t.chain, t.token_symbol, t.token_decimals
  `;

  /** @type {Map<string, { chain: string, token_symbol: string, token_decimals: number, bal: bigint }>} */
  const map = new Map();

  for (const r of /** @type {{ chain: string, tokenSymbol: string, tokenDecimals: number, sumAmount: string }[]} */ (
    inboundRows
  )) {
    const k = `${r.chain}:${r.tokenSymbol}:${r.tokenDecimals}`;
    map.set(k, {
      chain: r.chain,
      token_symbol: r.tokenSymbol,
      token_decimals: r.tokenDecimals,
      bal: bigIntFromPgNumericText(r.sumAmount),
    });
  }

  if (environment === MerchantGatewayEnv.live) {
    const outRows = await prisma.$queryRaw`
      SELECT
        w.chain::text AS chain,
        w.token_symbol AS "tokenSymbol",
        SUM(w.amount::numeric)::text AS "sumAmount"
      FROM "withdrawals" w
      WHERE w.merchant_id = ${merchantId}
        AND w.status = 'completed'::"WithdrawalStatus"
      GROUP BY w.chain, w.token_symbol
    `;

    for (const r of /** @type {{ chain: string, tokenSymbol: string, sumAmount: string }[]} */ (
      outRows
    )) {
      const n = bigIntFromPgNumericText(r.sumAmount);
      for (const v of map.values()) {
        if (v.chain === r.chain && v.token_symbol === r.tokenSymbol) {
          v.bal -= n;
          break;
        }
      }
    }
  }

  const settleRows = await prisma.$queryRaw`
    SELECT
      ms.chain::text AS chain,
      ms.token_symbol AS "tokenSymbol",
      ms.token_decimals AS "tokenDecimals",
      SUM(ms.net_amount::numeric)::text AS "sumAmount"
    FROM "merchant_settlements" ms
    WHERE ms.merchant_id = ${merchantId}
      AND ms.environment = ${environment}::"MerchantGatewayEnv"
    GROUP BY ms.chain, ms.token_symbol, ms.token_decimals
  `;

  for (const r of /** @type {{ chain: string, tokenSymbol: string, tokenDecimals: number, sumAmount: string }[]} */ (
    settleRows
  )) {
    const k = `${r.chain}:${r.tokenSymbol}:${r.tokenDecimals}`;
    const n = bigIntFromPgNumericText(r.sumAmount);
    const prev = map.get(k);
    if (prev) {
      prev.bal -= n;
    } else {
      map.set(k, {
        chain: r.chain,
        token_symbol: r.tokenSymbol,
        token_decimals: r.tokenDecimals,
        bal: -n,
      });
    }
  }

  return [...map.values()]
    .filter((r) => r.bal > 0n)
    .map((r) => ({
      chain: r.chain,
      token_symbol: r.token_symbol,
      token_decimals: r.token_decimals,
      balance_raw: r.bal.toString(),
    }))
    .sort((a, b) =>
      `${a.chain}:${a.token_symbol}`.localeCompare(`${b.chain}:${b.token_symbol}`),
    );
}

export async function merchantBalanceForAsset(merchantId, chain, tokenSymbol) {
  const [inRow, outRow, settleRow] = await Promise.all([
    prisma.$queryRaw`
      SELECT COALESCE(SUM(t.amount::numeric), 0)::text AS s
      FROM "transactions" t
      INNER JOIN "wallets" w ON w.id = t.wallet_id
      WHERE t.status = 'success'
        AND w.merchant_id = ${merchantId}
        AND w.environment = ${MerchantGatewayEnv.live}::"MerchantGatewayEnv"
        AND t.chain = ${chain}::"Chain"
        AND t.token_symbol = ${tokenSymbol}
    `,
    prisma.$queryRaw`
      SELECT COALESCE(SUM(amount::numeric), 0)::text AS s
      FROM "withdrawals"
      WHERE merchant_id = ${merchantId}
        AND status = 'completed'::"WithdrawalStatus"
        AND chain = ${chain}::"Chain"
        AND token_symbol = ${tokenSymbol}
    `,
    prisma.$queryRaw`
      SELECT COALESCE(SUM(net_amount::numeric), 0)::text AS s
      FROM "merchant_settlements"
      WHERE merchant_id = ${merchantId}
        AND environment = ${MerchantGatewayEnv.live}::"MerchantGatewayEnv"
        AND chain = ${chain}::"Chain"
        AND token_symbol = ${tokenSymbol}
    `,
  ]);

  const inS = /** @type {{ s: string }[]} */ (inRow)[0]?.s ?? "0";
  const outS = /** @type {{ s: string }[]} */ (outRow)[0]?.s ?? "0";
  const settleS = /** @type {{ s: string }[]} */ (settleRow)[0]?.s ?? "0";
  const bal =
    bigIntFromPgNumericText(inS) -
    bigIntFromPgNumericText(outS) -
    bigIntFromPgNumericText(settleS);
  return bal > 0n ? bal : 0n;
}
