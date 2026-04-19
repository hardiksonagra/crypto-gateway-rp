import { TxStatus } from "@prisma/client";

/**
 * Prisma / Postgres `TxStatus` value for under-paid fixed-amount checkouts.
 *
 * Use for **JavaScript comparisons** and JSON bodies. For Prisma `where` / `data` that
 * reference `TxStatus`, prefer {@link prismaClientKnowsTxStatusUnderpaid}: when this is
 * false (stale generated client), use raw SQL helpers in `underpaid-prisma-raw.js` so
 * production keeps working until `npx prisma generate` is run from `server/`.
 *
 * @type {import("@prisma/client").TxStatus}
 */
export const TX_STATUS_UNDERPAID = "underpaid";

/**
 * After `ALTER TYPE "TxStatus" ADD VALUE 'underpaid'` and `prisma generate`, the
 * client exposes `TxStatus.underpaid`. Older `node_modules/@prisma/client` rejects
 * `"underpaid"` in Prisma queries at validation time — branch on this and use raw SQL.
 *
 * @returns {boolean}
 */
export function prismaClientKnowsTxStatusUnderpaid() {
  return typeof TxStatus.underpaid === "string";
}
