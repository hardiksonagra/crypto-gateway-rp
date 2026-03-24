-- CreateEnum
CREATE TYPE "MerchantGatewayEnv" AS ENUM ('live', 'sandbox');

-- AlterTable
ALTER TABLE "admin_users" ADD COLUMN "live_gateway_enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "admin_users" ADD COLUMN "sandbox_gateway_enabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "users" ADD COLUMN "environment" "MerchantGatewayEnv" NOT NULL DEFAULT 'live';

DROP INDEX IF EXISTS "users_merchant_id_external_user_id_key";

CREATE UNIQUE INDEX "users_merchant_id_external_user_id_environment_key" ON "users"("merchant_id", "external_user_id", "environment");

CREATE INDEX "users_merchant_id_environment_idx" ON "users"("merchant_id", "environment");
