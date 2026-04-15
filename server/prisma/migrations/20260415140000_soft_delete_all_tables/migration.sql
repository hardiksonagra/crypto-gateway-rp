-- Soft-delete columns + non-cascading FKs + partial uniques for "active" rows only.

BEGIN;

-- 1) Columns (nullable; existing rows remain active)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ;
ALTER TABLE "wallets" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ;
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ;
ALTER TABLE "wallet_assignment_events" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ;
ALTER TABLE "merchant_settlements" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ;
ALTER TABLE "withdrawals" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ;
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ;
ALTER TABLE "panel_audit_logs" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ;
ALTER TABLE "scanner_state" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ;
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ;

-- 2) Drop FKs that reference or are referenced by tables whose uniqueness we change
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_wallet_id_fkey";
ALTER TABLE "wallet_assignment_events" DROP CONSTRAINT IF EXISTS "wallet_assignment_events_wallet_id_fkey";
ALTER TABLE "wallet_assignment_events" DROP CONSTRAINT IF EXISTS "wallet_assignment_events_user_id_fkey";
ALTER TABLE "wallet_assignment_events" DROP CONSTRAINT IF EXISTS "wallet_assignment_events_merchant_id_fkey";
ALTER TABLE "wallets" DROP CONSTRAINT IF EXISTS "wallets_merchant_id_fkey";
ALTER TABLE "wallets" DROP CONSTRAINT IF EXISTS "wallets_assigned_user_id_fkey";
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_merchant_id_fkey";
ALTER TABLE "merchant_settlements" DROP CONSTRAINT IF EXISTS "merchant_settlements_merchant_id_fkey";
ALTER TABLE "withdrawals" DROP CONSTRAINT IF EXISTS "withdrawals_merchant_id_fkey";

-- 3) Replace global uniques with partial uniques (one active row per business key)
DROP INDEX IF EXISTS "wallets_merchant_id_environment_chain_currency_network_address_key";
CREATE UNIQUE INDEX "wallets_merchant_id_environment_chain_currency_network_address_key"
  ON "wallets" ("merchant_id", "environment", "chain", "currency", "network", "address")
  WHERE "deleted_at" IS NULL;

DROP INDEX IF EXISTS "users_merchant_id_external_user_id_environment_key";
CREATE UNIQUE INDEX "users_merchant_id_external_user_id_environment_key"
  ON "users" ("merchant_id", "external_user_id", "environment")
  WHERE "deleted_at" IS NULL;

DROP INDEX IF EXISTS "scanner_state_currency_network_key";
CREATE UNIQUE INDEX "scanner_state_currency_network_key"
  ON "scanner_state" ("currency", "network")
  WHERE "deleted_at" IS NULL;

DROP INDEX IF EXISTS "app_settings_key_key";
CREATE UNIQUE INDEX "app_settings_key_key"
  ON "app_settings" ("key")
  WHERE "deleted_at" IS NULL;

-- 4) Helpful filters
CREATE INDEX IF NOT EXISTS "users_deleted_at_idx" ON "users" ("deleted_at");
CREATE INDEX IF NOT EXISTS "wallets_deleted_at_idx" ON "wallets" ("deleted_at");
CREATE INDEX IF NOT EXISTS "transactions_deleted_at_idx" ON "transactions" ("deleted_at");
CREATE INDEX IF NOT EXISTS "wallet_assignment_events_deleted_at_idx" ON "wallet_assignment_events" ("deleted_at");
CREATE INDEX IF NOT EXISTS "merchant_settlements_deleted_at_idx" ON "merchant_settlements" ("deleted_at");
CREATE INDEX IF NOT EXISTS "withdrawals_deleted_at_idx" ON "withdrawals" ("deleted_at");
CREATE INDEX IF NOT EXISTS "audit_logs_deleted_at_idx" ON "audit_logs" ("deleted_at");
CREATE INDEX IF NOT EXISTS "panel_audit_logs_deleted_at_idx" ON "panel_audit_logs" ("deleted_at");
CREATE INDEX IF NOT EXISTS "scanner_state_deleted_at_idx" ON "scanner_state" ("deleted_at");
CREATE INDEX IF NOT EXISTS "app_settings_deleted_at_idx" ON "app_settings" ("deleted_at");

-- 5) Recreate FKs — no CASCADE to parent deletes (soft-delete only at app layer)
ALTER TABLE "merchant_settlements" ADD CONSTRAINT "merchant_settlements_merchant_id_fkey"
  FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "users" ADD CONSTRAINT "users_merchant_id_fkey"
  FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "wallets" ADD CONSTRAINT "wallets_merchant_id_fkey"
  FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "wallets" ADD CONSTRAINT "wallets_assigned_user_id_fkey"
  FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "wallet_assignment_events" ADD CONSTRAINT "wallet_assignment_events_wallet_id_fkey"
  FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "wallet_assignment_events" ADD CONSTRAINT "wallet_assignment_events_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "wallet_assignment_events" ADD CONSTRAINT "wallet_assignment_events_merchant_id_fkey"
  FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_wallet_id_fkey"
  FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_merchant_id_fkey"
  FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
