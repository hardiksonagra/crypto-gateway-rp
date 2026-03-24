-- AlterTable
ALTER TABLE "admin_users" ADD COLUMN "deleted_at" TIMESTAMP(3);

CREATE INDEX "admin_users_deleted_at_idx" ON "admin_users"("deleted_at");
