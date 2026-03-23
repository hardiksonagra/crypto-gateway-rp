-- AlterTable
ALTER TABLE "admin_users" ADD COLUMN     "password_reset_token_hash" TEXT,
ADD COLUMN     "password_reset_expires_at" TIMESTAMP(3);
