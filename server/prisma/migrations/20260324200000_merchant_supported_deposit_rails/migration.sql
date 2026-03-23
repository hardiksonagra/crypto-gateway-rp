-- AlterTable
ALTER TABLE "admin_users" ADD COLUMN "supported_deposit_rails" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
