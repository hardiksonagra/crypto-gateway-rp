/**
 * Prisma / Postgres `TxStatus` value for under-paid fixed-amount checkouts.
 *
 * Always use this **string literal** in `where` / `data` / comparisons — do not use
 * `TxStatus.underpaid` from `@prisma/client` until `npx prisma generate` has run after
 * the enum migration; otherwise it can be `undefined` and breaks `status: { in: [...] }`.
 *
 * @type {import("@prisma/client").TxStatus}
 */
export const TX_STATUS_UNDERPAID = "underpaid";
