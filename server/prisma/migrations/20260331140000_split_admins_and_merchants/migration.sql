-- Split portal accounts: platform admins (`admins`) vs gateway merchants (`merchants`).
-- Preserves row ids so FKs on users/wallets/withdrawals/wallet_assignment_events stay valid.

CREATE TABLE "admins" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "portal_environment" "MerchantGatewayEnv" NOT NULL DEFAULT 'live',
    "password_reset_token_hash" TEXT,
    "password_reset_expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "admins_email_not_deleted_key" ON "admins"("email") WHERE "deleted_at" IS NULL;
CREATE INDEX "admins_deleted_at_idx" ON "admins"("deleted_at");

CREATE TABLE "merchants" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT,
    "api_key_hash" TEXT,
    "api_key_hint" TEXT,
    "api_key_cipher" TEXT,
    "sandbox_api_key_hash" TEXT,
    "sandbox_api_key_hint" TEXT,
    "sandbox_api_key_cipher" TEXT,
    "callback_url" TEXT,
    "default_chains" "Chain"[] NOT NULL DEFAULT ARRAY[]::"Chain"[],
    "default_currency" TEXT NOT NULL DEFAULT 'USDT',
    "default_network" TEXT NOT NULL DEFAULT 'TRC20',
    "supported_deposit_rails" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "live_gateway_enabled" BOOLEAN NOT NULL DEFAULT true,
    "sandbox_gateway_enabled" BOOLEAN NOT NULL DEFAULT true,
    "portal_environment" "MerchantGatewayEnv" NOT NULL DEFAULT 'sandbox',
    "password_reset_token_hash" TEXT,
    "password_reset_expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "merchants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "merchants_email_not_deleted_key" ON "merchants"("email") WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "merchants_api_key_hash_key" ON "merchants"("api_key_hash");
CREATE UNIQUE INDEX "merchants_sandbox_api_key_hash_key" ON "merchants"("sandbox_api_key_hash");
CREATE INDEX "merchants_deleted_at_idx" ON "merchants"("deleted_at");

INSERT INTO "admins" (
    "id", "email", "password_hash", "display_name", "is_active", "deleted_at",
    "portal_environment", "password_reset_token_hash", "password_reset_expires_at",
    "created_at", "updated_at"
)
SELECT
    "id", "email", "password_hash", "display_name", "is_active", "deleted_at",
    "portal_environment", "password_reset_token_hash", "password_reset_expires_at",
    "created_at", "updated_at"
FROM "admin_users"
WHERE "role" = 'ADMIN';

INSERT INTO "merchants" (
    "id", "email", "password_hash", "display_name",
    "api_key_hash", "api_key_hint", "api_key_cipher",
    "sandbox_api_key_hash", "sandbox_api_key_hint", "sandbox_api_key_cipher",
    "callback_url", "default_chains", "default_currency", "default_network", "supported_deposit_rails",
    "is_active", "deleted_at", "live_gateway_enabled", "sandbox_gateway_enabled", "portal_environment",
    "password_reset_token_hash", "password_reset_expires_at", "created_at", "updated_at"
)
SELECT
    "id", "email", "password_hash", "display_name",
    "api_key_hash", "api_key_hint", "api_key_cipher",
    "sandbox_api_key_hash", "sandbox_api_key_hint", "sandbox_api_key_cipher",
    "callback_url", "default_chains", "default_currency", "default_network", "supported_deposit_rails",
    "is_active", "deleted_at", "live_gateway_enabled", "sandbox_gateway_enabled", "portal_environment",
    "password_reset_token_hash", "password_reset_expires_at", "created_at", "updated_at"
FROM "admin_users"
WHERE "role" = 'MERCHANT';

ALTER TABLE "wallet_assignment_events" DROP CONSTRAINT "wallet_assignment_events_merchant_id_fkey";
ALTER TABLE "wallets" DROP CONSTRAINT "wallets_merchant_id_fkey";
ALTER TABLE "withdrawals" DROP CONSTRAINT "withdrawals_merchant_id_fkey";
ALTER TABLE "users" DROP CONSTRAINT "users_merchant_id_fkey";

DROP TABLE "admin_users";

DROP TYPE "AdminRole";

ALTER TABLE "users" ADD CONSTRAINT "users_merchant_id_fkey"
  FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_merchant_id_fkey"
  FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_merchant_id_fkey"
  FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wallet_assignment_events" ADD CONSTRAINT "wallet_assignment_events_merchant_id_fkey"
  FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
