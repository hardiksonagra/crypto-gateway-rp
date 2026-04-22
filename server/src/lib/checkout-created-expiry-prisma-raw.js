/**
 * Raw SQL for stale checkout expiry when `@prisma/client` has no `TxStatus.created` (Prisma may drop
 * `status` from `where`, which would incorrectly match non-placeholder rows).
 *
 * Targets: `gateway-created:*` checkout placeholders — `created`, or stuck `pending` with `amount` `0`.
 */
import { Prisma } from "@prisma/client";

/**
 * @param {import("@prisma/client").PrismaClient} prisma
 * @param {{ cutoff: Date; batchSize: number }} p
 * @returns {Promise<Array<{ id: number; wallet_id: number }>>}
 */
export async function findStaleCreatedCheckoutPlaceholderBatchRaw(
  prisma,
  { cutoff, batchSize },
) {
  return prisma.$queryRaw(
    Prisma.sql`
      SELECT t.id, t.wallet_id
      FROM transactions t
      WHERE t.deleted_at IS NULL
        AND t.created_at < ${cutoff}
        AND t.tx_hash LIKE 'gateway-created:%'
        AND (
          (t.status)::text = 'created'
          OR (
            (t.status)::text = 'pending'
            AND trim(t.amount) = '0'
          )
        )
      ORDER BY t.created_at ASC
      LIMIT ${batchSize}
    `,
  );
}

/**
 * @param {import("@prisma/client").PrismaClient} prisma
 * @param {{ id: number; cutoff: Date }} p
 * @returns {Promise<boolean>} true when exactly one row was updated
 */
export async function markStaleCreatedCheckoutPlaceholderFailedRaw(
  prisma,
  { id, cutoff },
) {
  const rows = await prisma.$queryRaw(
    Prisma.sql`
      UPDATE transactions t
      SET
        status = CAST('failed' AS "TxStatus"),
        updated_at = NOW()
      WHERE t.id = ${id}
        AND t.deleted_at IS NULL
        AND t.created_at < ${cutoff}
        AND t.tx_hash LIKE 'gateway-created:%'
        AND (
          (t.status)::text = 'created'
          OR (
            (t.status)::text = 'pending'
            AND trim(t.amount) = '0'
          )
        )
      RETURNING t.id
    `,
  );
  return Array.isArray(rows) && rows.length === 1;
}
