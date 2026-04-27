import { Prisma } from "@prisma/client";
import { EVM_CHAINS } from "../config/chains.js";

/**
 * Matches admin “All wallets” unique merge: one row per
 * `(normalized_address, chain, currency, network, environment)`; EVM addresses compared case-insensitively.
 *
 * @param {import("@prisma/client").PrismaClient} prisma
 * @param {import("@prisma/client").MerchantGatewayEnv} listEnv
 * @returns {Promise<number>}
 */
export async function countDistinctWalletDepositIdentitiesInEnv(prisma, listEnv) {
  const evmChainSql =
    EVM_CHAINS.length === 0
      ? Prisma.sql`FALSE`
      : Prisma.join(
          EVM_CHAINS.map((c) => Prisma.sql`w.chain = ${c}::"Chain"`),
          Prisma.sql` OR `,
        );
  const rows = await prisma.$queryRaw(
    Prisma.sql`
      SELECT COUNT(*)::int AS cnt
      FROM (
        SELECT 1
        FROM wallets w
        WHERE w.environment = ${listEnv}::"MerchantGatewayEnv"
          AND w.deleted_at IS NULL
        GROUP BY
          CASE
            WHEN (${evmChainSql}) THEN lower(trim(w.address::text))
            ELSE trim(w.address::text)
          END,
          w.chain,
          w.currency,
          w.network,
          w.environment
      ) sub
    `,
  );
  return Number(rows[0]?.cnt ?? 0);
}
