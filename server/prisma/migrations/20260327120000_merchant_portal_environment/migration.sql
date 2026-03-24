-- AlterTable
ALTER TABLE "admin_users" ADD COLUMN "portal_environment" "MerchantGatewayEnv" NOT NULL DEFAULT 'sandbox';

-- Merchants created before this column followed the old URL default (live).
UPDATE "admin_users" SET "portal_environment" = 'live' WHERE "role" = 'MERCHANT';
