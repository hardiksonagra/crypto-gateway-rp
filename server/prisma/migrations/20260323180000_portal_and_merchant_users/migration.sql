-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('ADMIN', 'MERCHANT');

-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');

-- CreateTable
CREATE TABLE "admin_users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL,
    "display_name" TEXT,
    "api_key_hash" TEXT,
    "api_key_hint" TEXT,
    "callback_url" TEXT,
    "default_chain" "Chain" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");
CREATE UNIQUE INDEX "admin_users_api_key_hash_key" ON "admin_users"("api_key_hash");

-- Seed portal users (passwords: Admin#ChangeMe1 / Merchant#Demo1)
-- Demo merchant API secret (document in CLIENT_INTEGRATION): cpg_live_demo_dev_only_change_me
-- SHA-256 hex of that secret:
INSERT INTO "admin_users" ("id", "email", "password_hash", "role", "default_chain", "is_active", "api_key_hash", "api_key_hint", "created_at", "updated_at")
VALUES
(
    'clseedadmin00000000001',
    'admin@gateway.local',
    '$2b$10$PLEPUUw6JHC701vJEZ30OeVwgAYcT2wXtLrQPIjSJxKfA8MiNiqP6',
    'ADMIN',
    'ETH',
    true,
    NULL,
    NULL,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
),
(
    'clseedmerchant00000001',
    'merchant@gateway.local',
    '$2b$10$pj4wuy36UXV2xieVEQ6/EOMj0JVkpkguH1Do/LWT8jj3z/9SVDCuO',
    'MERCHANT',
    'TRON',
    true,
    '6ca8702a514fdd1a8266a539f1b2fc3fe293e7f6ed5ddcb24c1180cf04268b56',
    'ge_me',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "withdrawals" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "chain" "Chain" NOT NULL,
    "token_symbol" TEXT NOT NULL,
    "to_address" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'pending',
    "tx_hash" TEXT,
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "withdrawals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "withdrawals_merchant_id_created_at_idx" ON "withdrawals"("merchant_id", "created_at");

ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Users: attach to demo merchant, drop legacy columns
ALTER TABLE "users" ADD COLUMN "merchant_id" TEXT;

UPDATE "users" SET "external_user_id" = COALESCE(NULLIF(TRIM("external_user_id"), ''), "email") WHERE "external_user_id" IS NULL OR TRIM("external_user_id") = '';

ALTER TABLE "users" ALTER COLUMN "external_user_id" SET NOT NULL;

DROP INDEX IF EXISTS "users_email_key";

ALTER TABLE "users" DROP COLUMN "email",
DROP COLUMN "callback_url",
DROP COLUMN "merchant_ref";

UPDATE "users" SET "merchant_id" = 'clseedmerchant00000001' WHERE "merchant_id" IS NULL;

ALTER TABLE "users" ALTER COLUMN "merchant_id" SET NOT NULL;

CREATE UNIQUE INDEX "users_merchant_id_external_user_id_key" ON "users"("merchant_id", "external_user_id");

ALTER TABLE "users" ADD CONSTRAINT "users_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
