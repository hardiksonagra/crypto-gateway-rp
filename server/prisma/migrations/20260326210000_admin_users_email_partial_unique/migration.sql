-- Unique email only among non-deleted portal users so a new merchant/admin can reuse email after soft-delete.
DROP INDEX IF EXISTS "admin_users_email_key";

CREATE UNIQUE INDEX "admin_users_email_not_deleted_key" ON "admin_users"("email") WHERE "deleted_at" IS NULL;
