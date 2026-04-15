/**
 * Prisma `where` fragment: row is not soft-deleted (`deleted_at IS NULL`).
 * Merge into `where` objects for models that define `deletedAt`.
 *
 * If the generated client predates `deletedAt`, {@link disableActiveRowSoftDeleteFilter}
 * removes the key so `where: { ...ACTIVE }` does not crash validation.
 */
export const ACTIVE = { deletedAt: null };

/**
 * Clears {@link ACTIVE}'s `deletedAt` key after detecting an outdated `@prisma/client`.
 * Do not use for AppSetting-only flows — use a literal `{ deletedAt: null }` there instead.
 */
export function disableActiveRowSoftDeleteFilter() {
  delete ACTIVE.deletedAt;
}
