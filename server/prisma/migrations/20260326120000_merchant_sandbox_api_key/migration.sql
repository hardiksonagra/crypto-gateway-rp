-- AlterTable
ALTER TABLE "admin_users" ADD COLUMN "sandbox_api_key_hash" TEXT;
ALTER TABLE "admin_users" ADD COLUMN "sandbox_api_key_hint" TEXT;
ALTER TABLE "admin_users" ADD COLUMN "sandbox_api_key_cipher" TEXT;

CREATE UNIQUE INDEX "admin_users_sandbox_api_key_hash_key" ON "admin_users"("sandbox_api_key_hash");
