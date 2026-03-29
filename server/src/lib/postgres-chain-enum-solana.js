import { prisma } from "./prisma.js";

/** @type {boolean | null} */
let chainEnumHasSolanaCache = null;

/**
 * Whether Postgres type `Chain` includes enum label `SOLANA` (Prisma migration applied).
 * Cached per process so we never send `chain: SOLANA` to Prisma when the DB rejects it.
 *
 * @returns {Promise<boolean>}
 */
export async function postgresChainEnumHasSolana() {
  if (chainEnumHasSolanaCache !== null) {
    return chainEnumHasSolanaCache;
  }
  try {
    const rows = await prisma.$queryRaw`
      SELECT 1 AS ok
      FROM pg_enum e
      INNER JOIN pg_type t ON e.enumtypid = t.oid
      WHERE (t.typname = 'Chain' OR t.typname = 'chain')
        AND e.enumlabel = 'SOLANA'
      LIMIT 1
    `;
    chainEnumHasSolanaCache = Array.isArray(rows) && rows.length > 0;
  } catch {
    chainEnumHasSolanaCache = false;
  }
  return chainEnumHasSolanaCache;
}
