import { MerchantGatewayEnv, WithdrawalStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

/**
 * @param {string} merchantId
 * @param {import("@prisma/client").MerchantGatewayEnv} [environment]
 */
export async function computeMerchantBalances(
  merchantId,
  environment = MerchantGatewayEnv.live,
) {
  const inbound = await prisma.transaction.findMany({
    where: {
      status: "success",
      wallet: { user: { merchantId, environment } },
    },
    select: { amount: true, tokenSymbol: true, tokenDecimals: true, chain: true },
  });

  const map = new Map();

  for (const t of inbound) {
    const k = `${t.chain}:${t.tokenSymbol}`;
    const prev = map.get(k);
    const n = BigInt(t.amount);
    if (prev) prev.bal += n;
    else
      map.set(k, {
        chain: t.chain,
        token_symbol: t.tokenSymbol,
        token_decimals: t.tokenDecimals,
        bal: n,
      });
  }

  if (environment === MerchantGatewayEnv.live) {
    const out = await prisma.withdrawal.findMany({
      where: { merchantId, status: WithdrawalStatus.completed },
      select: { amount: true, tokenSymbol: true, chain: true },
    });
    for (const w of out) {
      const k = `${w.chain}:${w.tokenSymbol}`;
      const prev = map.get(k);
      const n = BigInt(w.amount);
      if (prev) prev.bal -= n;
      else {
        const dec =
          inbound.find((x) => x.chain === w.chain && x.tokenSymbol === w.tokenSymbol)
            ?.tokenDecimals ?? 18;
        map.set(k, {
          chain: w.chain,
          token_symbol: w.tokenSymbol,
          token_decimals: dec,
          bal: -n,
        });
      }
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
  const rows = await computeMerchantBalances(merchantId, MerchantGatewayEnv.live);
  const hit = rows.find((r) => r.chain === chain && r.token_symbol === tokenSymbol);
  return hit ? BigInt(hit.balance_raw) : 0n;
}
