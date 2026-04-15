/**
 * Prisma `where` fragment: row is not soft-deleted (`deleted_at IS NULL`).
 * Merge into `where` objects for models that define `deletedAt`.
 */
export const ACTIVE = { deletedAt: null };
