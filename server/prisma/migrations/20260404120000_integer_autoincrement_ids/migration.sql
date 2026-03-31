-- Integer autoincrement primary keys + stable `public_id` (former TEXT `id`) for all entity tables.
-- Rewires foreign keys from TEXT cuid → INTEGER. Preserves existing `public_id` values = old row ids.

-- 1) Drop incoming foreign keys (children → parents)
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_merchant_settlement_id_fkey";
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_payer_user_id_fkey";
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_wallet_id_fkey";
ALTER TABLE "merchant_settlements" DROP CONSTRAINT IF EXISTS "merchant_settlements_merchant_id_fkey";
ALTER TABLE "wallet_assignment_events" DROP CONSTRAINT IF EXISTS "wallet_assignment_events_wallet_id_fkey";
ALTER TABLE "wallet_assignment_events" DROP CONSTRAINT IF EXISTS "wallet_assignment_events_user_id_fkey";
ALTER TABLE "wallet_assignment_events" DROP CONSTRAINT IF EXISTS "wallet_assignment_events_merchant_id_fkey";
ALTER TABLE "wallets" DROP CONSTRAINT IF EXISTS "wallets_merchant_id_fkey";
ALTER TABLE "wallets" DROP CONSTRAINT IF EXISTS "wallets_assigned_user_id_fkey";
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_merchant_id_fkey";
ALTER TABLE "withdrawals" DROP CONSTRAINT IF EXISTS "withdrawals_merchant_id_fkey";

-- 2) Drop indexes that reference columns we will rewrite
DROP INDEX IF EXISTS "transactions_tx_hash_chain_wallet_id_token_symbol_log_index_key";
DROP INDEX IF EXISTS "transactions_wallet_id_created_at_idx";
DROP INDEX IF EXISTS "transactions_payer_user_id_idx";
DROP INDEX IF EXISTS "transactions_merchant_settlement_id_idx";

DROP INDEX IF EXISTS "wallets_merchant_id_environment_chain_currency_network_address_key";
DROP INDEX IF EXISTS "wallets_merchant_id_environment_chain_currency_network_idx";
DROP INDEX IF EXISTS "wallets_assigned_user_id_idx";

DROP INDEX IF EXISTS "users_merchant_id_external_user_id_environment_key";
DROP INDEX IF EXISTS "users_merchant_id_environment_idx";

DROP INDEX IF EXISTS "audit_logs_merchant_id_idx";

-- 3) admins
ALTER TABLE "admins" DROP CONSTRAINT "admins_pkey";
ALTER TABLE "admins" RENAME COLUMN "id" TO "public_id";
ALTER TABLE "admins" ADD COLUMN "id" SERIAL NOT NULL;
ALTER TABLE "admins" ADD CONSTRAINT "admins_pkey" PRIMARY KEY ("id");
CREATE UNIQUE INDEX "admins_public_id_key" ON "admins"("public_id");

-- 4) merchants
ALTER TABLE "merchants" DROP CONSTRAINT "merchants_pkey";
ALTER TABLE "merchants" RENAME COLUMN "id" TO "public_id";
ALTER TABLE "merchants" ADD COLUMN "id" SERIAL NOT NULL;
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_pkey" PRIMARY KEY ("id");
CREATE UNIQUE INDEX "merchants_public_id_key" ON "merchants"("public_id");

-- 5) scanner_state
ALTER TABLE "scanner_state" DROP CONSTRAINT "scanner_state_pkey";
ALTER TABLE "scanner_state" RENAME COLUMN "id" TO "public_id";
ALTER TABLE "scanner_state" ADD COLUMN "id" SERIAL NOT NULL;
ALTER TABLE "scanner_state" ADD CONSTRAINT "scanner_state_pkey" PRIMARY KEY ("id");
CREATE UNIQUE INDEX "scanner_state_public_id_key" ON "scanner_state"("public_id");

-- 6) panel_audit_logs
ALTER TABLE "panel_audit_logs" DROP CONSTRAINT "panel_audit_logs_pkey";
ALTER TABLE "panel_audit_logs" RENAME COLUMN "id" TO "public_id";
ALTER TABLE "panel_audit_logs" ADD COLUMN "id" SERIAL NOT NULL;
ALTER TABLE "panel_audit_logs" ADD CONSTRAINT "panel_audit_logs_pkey" PRIMARY KEY ("id");
CREATE UNIQUE INDEX "panel_audit_logs_public_id_key" ON "panel_audit_logs"("public_id");

-- 7) app_settings: new surrogate PK; `key` stays unique business key
ALTER TABLE "app_settings" DROP CONSTRAINT "app_settings_pkey";
ALTER TABLE "app_settings" ADD COLUMN "id" SERIAL NOT NULL;
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id");
CREATE UNIQUE INDEX "app_settings_key_key" ON "app_settings"("key");

-- 8) merchant_settlements (depends on merchants + admins)
ALTER TABLE "merchant_settlements" DROP CONSTRAINT "merchant_settlements_pkey";
ALTER TABLE "merchant_settlements" RENAME COLUMN "id" TO "public_id";
ALTER TABLE "merchant_settlements" ADD COLUMN "id" SERIAL NOT NULL;
ALTER TABLE "merchant_settlements" ADD CONSTRAINT "merchant_settlements_pkey" PRIMARY KEY ("id");
CREATE UNIQUE INDEX "merchant_settlements_public_id_key" ON "merchant_settlements"("public_id");

ALTER TABLE "merchant_settlements" ADD COLUMN "merchant_id_new" INTEGER;
UPDATE "merchant_settlements" ms SET "merchant_id_new" = m."id" FROM "merchants" m WHERE ms."merchant_id" = m."public_id";
ALTER TABLE "merchant_settlements" DROP COLUMN "merchant_id";
ALTER TABLE "merchant_settlements" RENAME COLUMN "merchant_id_new" TO "merchant_id";
ALTER TABLE "merchant_settlements" ALTER COLUMN "merchant_id" SET NOT NULL;

ALTER TABLE "merchant_settlements" ADD COLUMN "created_by_admin_id_new" INTEGER;
UPDATE "merchant_settlements" ms SET "created_by_admin_id_new" = a."id" FROM "admins" a WHERE ms."created_by_admin_id" IS NOT NULL AND ms."created_by_admin_id" = a."public_id";
ALTER TABLE "merchant_settlements" DROP COLUMN "created_by_admin_id";
ALTER TABLE "merchant_settlements" RENAME COLUMN "created_by_admin_id_new" TO "created_by_admin_id";

CREATE INDEX "merchant_settlements_merchant_id_environment_created_at_idx" ON "merchant_settlements"("merchant_id", "environment", "created_at" DESC);

-- 9) users
ALTER TABLE "users" DROP CONSTRAINT "users_pkey";
ALTER TABLE "users" RENAME COLUMN "id" TO "public_id";
ALTER TABLE "users" ADD COLUMN "id" SERIAL NOT NULL;
ALTER TABLE "users" ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");
CREATE UNIQUE INDEX "users_public_id_key" ON "users"("public_id");

ALTER TABLE "users" ADD COLUMN "merchant_id_new" INTEGER;
UPDATE "users" u SET "merchant_id_new" = m."id" FROM "merchants" m WHERE u."merchant_id" = m."public_id";
ALTER TABLE "users" DROP COLUMN "merchant_id";
ALTER TABLE "users" RENAME COLUMN "merchant_id_new" TO "merchant_id";
ALTER TABLE "users" ALTER COLUMN "merchant_id" SET NOT NULL;

-- 10) wallets
ALTER TABLE "wallets" DROP CONSTRAINT "wallets_pkey";
ALTER TABLE "wallets" RENAME COLUMN "id" TO "public_id";
ALTER TABLE "wallets" ADD COLUMN "id" SERIAL NOT NULL;
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_pkey" PRIMARY KEY ("id");
CREATE UNIQUE INDEX "wallets_public_id_key" ON "wallets"("public_id");

ALTER TABLE "wallets" ADD COLUMN "merchant_id_new" INTEGER;
UPDATE "wallets" w SET "merchant_id_new" = m."id" FROM "merchants" m WHERE w."merchant_id" = m."public_id";
ALTER TABLE "wallets" DROP COLUMN "merchant_id";
ALTER TABLE "wallets" RENAME COLUMN "merchant_id_new" TO "merchant_id";
ALTER TABLE "wallets" ALTER COLUMN "merchant_id" SET NOT NULL;

ALTER TABLE "wallets" ADD COLUMN "assigned_user_id_new" INTEGER;
UPDATE "wallets" w SET "assigned_user_id_new" = u."id" FROM "users" u WHERE w."assigned_user_id" IS NOT NULL AND w."assigned_user_id" = u."public_id";
ALTER TABLE "wallets" DROP COLUMN "assigned_user_id";
ALTER TABLE "wallets" RENAME COLUMN "assigned_user_id_new" TO "assigned_user_id";

-- 11) wallet_assignment_events
ALTER TABLE "wallet_assignment_events" DROP CONSTRAINT "wallet_assignment_events_pkey";
ALTER TABLE "wallet_assignment_events" RENAME COLUMN "id" TO "public_id";
ALTER TABLE "wallet_assignment_events" ADD COLUMN "id" SERIAL NOT NULL;
ALTER TABLE "wallet_assignment_events" ADD CONSTRAINT "wallet_assignment_events_pkey" PRIMARY KEY ("id");
CREATE UNIQUE INDEX "wallet_assignment_events_public_id_key" ON "wallet_assignment_events"("public_id");

ALTER TABLE "wallet_assignment_events" ADD COLUMN "wallet_id_new" INTEGER;
UPDATE "wallet_assignment_events" e SET "wallet_id_new" = w."id" FROM "wallets" w WHERE e."wallet_id" = w."public_id";
ALTER TABLE "wallet_assignment_events" DROP COLUMN "wallet_id";
ALTER TABLE "wallet_assignment_events" RENAME COLUMN "wallet_id_new" TO "wallet_id";
ALTER TABLE "wallet_assignment_events" ALTER COLUMN "wallet_id" SET NOT NULL;

ALTER TABLE "wallet_assignment_events" ADD COLUMN "user_id_new" INTEGER;
UPDATE "wallet_assignment_events" e SET "user_id_new" = u."id" FROM "users" u WHERE e."user_id" = u."public_id";
ALTER TABLE "wallet_assignment_events" DROP COLUMN "user_id";
ALTER TABLE "wallet_assignment_events" RENAME COLUMN "user_id_new" TO "user_id";
ALTER TABLE "wallet_assignment_events" ALTER COLUMN "user_id" SET NOT NULL;

ALTER TABLE "wallet_assignment_events" ADD COLUMN "merchant_id_new" INTEGER;
UPDATE "wallet_assignment_events" e SET "merchant_id_new" = m."id" FROM "merchants" m WHERE e."merchant_id" = m."public_id";
ALTER TABLE "wallet_assignment_events" DROP COLUMN "merchant_id";
ALTER TABLE "wallet_assignment_events" RENAME COLUMN "merchant_id_new" TO "merchant_id";
ALTER TABLE "wallet_assignment_events" ALTER COLUMN "merchant_id" SET NOT NULL;

-- 12) transactions
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_pkey";
ALTER TABLE "transactions" RENAME COLUMN "id" TO "public_id";
ALTER TABLE "transactions" ADD COLUMN "id" SERIAL NOT NULL;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_pkey" PRIMARY KEY ("id");
CREATE UNIQUE INDEX "transactions_public_id_key" ON "transactions"("public_id");

ALTER TABLE "transactions" ADD COLUMN "wallet_id_new" INTEGER;
UPDATE "transactions" t SET "wallet_id_new" = w."id" FROM "wallets" w WHERE t."wallet_id" = w."public_id";
ALTER TABLE "transactions" DROP COLUMN "wallet_id";
ALTER TABLE "transactions" RENAME COLUMN "wallet_id_new" TO "wallet_id";
ALTER TABLE "transactions" ALTER COLUMN "wallet_id" SET NOT NULL;

ALTER TABLE "transactions" ADD COLUMN "payer_user_id_new" INTEGER;
UPDATE "transactions" t SET "payer_user_id_new" = u."id" FROM "users" u WHERE t."payer_user_id" IS NOT NULL AND t."payer_user_id" = u."public_id";
ALTER TABLE "transactions" DROP COLUMN "payer_user_id";
ALTER TABLE "transactions" RENAME COLUMN "payer_user_id_new" TO "payer_user_id";

ALTER TABLE "transactions" ADD COLUMN "merchant_settlement_id_new" INTEGER;
UPDATE "transactions" t SET "merchant_settlement_id_new" = ms."id" FROM "merchant_settlements" ms WHERE t."merchant_settlement_id" IS NOT NULL AND t."merchant_settlement_id" = ms."public_id";
ALTER TABLE "transactions" DROP COLUMN "merchant_settlement_id";
ALTER TABLE "transactions" RENAME COLUMN "merchant_settlement_id_new" TO "merchant_settlement_id";

CREATE UNIQUE INDEX "tx_dedupe" ON "transactions"("tx_hash", "chain", "wallet_id", "token_symbol", "log_index");
CREATE INDEX "transactions_wallet_id_created_at_idx" ON "transactions"("wallet_id", "created_at" DESC);
CREATE INDEX "transactions_payer_user_id_idx" ON "transactions"("payer_user_id");
CREATE INDEX "transactions_merchant_settlement_id_idx" ON "transactions"("merchant_settlement_id");

-- 13) withdrawals
DROP INDEX IF EXISTS "withdrawals_merchant_id_created_at_idx";
ALTER TABLE "withdrawals" DROP CONSTRAINT "withdrawals_pkey";
ALTER TABLE "withdrawals" RENAME COLUMN "id" TO "public_id";
ALTER TABLE "withdrawals" ADD COLUMN "id" SERIAL NOT NULL;
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_pkey" PRIMARY KEY ("id");
CREATE UNIQUE INDEX "withdrawals_public_id_key" ON "withdrawals"("public_id");

ALTER TABLE "withdrawals" ADD COLUMN "merchant_id_new" INTEGER;
UPDATE "withdrawals" w SET "merchant_id_new" = m."id" FROM "merchants" m WHERE w."merchant_id" = m."public_id";
ALTER TABLE "withdrawals" DROP COLUMN "merchant_id";
ALTER TABLE "withdrawals" RENAME COLUMN "merchant_id_new" TO "merchant_id";
ALTER TABLE "withdrawals" ALTER COLUMN "merchant_id" SET NOT NULL;
CREATE INDEX "withdrawals_merchant_id_created_at_idx" ON "withdrawals"("merchant_id", "created_at");

-- 14) audit_logs
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_pkey";
ALTER TABLE "audit_logs" RENAME COLUMN "id" TO "public_id";
ALTER TABLE "audit_logs" ADD COLUMN "id" SERIAL NOT NULL;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");
CREATE UNIQUE INDEX "audit_logs_public_id_key" ON "audit_logs"("public_id");

ALTER TABLE "audit_logs" ADD COLUMN "merchant_id_new" INTEGER;
UPDATE "audit_logs" al SET "merchant_id_new" = m."id" FROM "merchants" m WHERE al."merchant_id" IS NOT NULL AND al."merchant_id" = m."public_id";
ALTER TABLE "audit_logs" DROP COLUMN "merchant_id";
ALTER TABLE "audit_logs" RENAME COLUMN "merchant_id_new" TO "merchant_id";
CREATE INDEX "audit_logs_merchant_id_idx" ON "audit_logs"("merchant_id");

-- 15) Recreate foreign keys
ALTER TABLE "merchant_settlements" ADD CONSTRAINT "merchant_settlements_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "merchant_settlements" ADD CONSTRAINT "merchant_settlements_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "users" ADD CONSTRAINT "users_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "wallets" ADD CONSTRAINT "wallets_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "wallet_assignment_events" ADD CONSTRAINT "wallet_assignment_events_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wallet_assignment_events" ADD CONSTRAINT "wallet_assignment_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wallet_assignment_events" ADD CONSTRAINT "wallet_assignment_events_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_payer_user_id_fkey" FOREIGN KEY ("payer_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_merchant_settlement_id_fkey" FOREIGN KEY ("merchant_settlement_id") REFERENCES "merchant_settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 16) Wallet list indexes (match Prisma schema)
CREATE UNIQUE INDEX "wallets_merchant_id_environment_chain_currency_network_address_key" ON "wallets"("merchant_id", "environment", "chain", "currency", "network", "address");
CREATE INDEX "wallets_merchant_id_environment_chain_currency_network_idx" ON "wallets"("merchant_id", "environment", "chain", "currency", "network");
CREATE INDEX "wallets_assigned_user_id_idx" ON "wallets"("assigned_user_id");

CREATE UNIQUE INDEX "users_merchant_id_external_user_id_environment_key" ON "users"("merchant_id", "external_user_id", "environment");
CREATE INDEX "users_merchant_id_environment_idx" ON "users"("merchant_id", "environment");

-- 17) Align sequences (defensive)
SELECT setval(pg_get_serial_sequence('"admins"', 'id'), COALESCE((SELECT MAX("id") FROM "admins"), 1));
SELECT setval(pg_get_serial_sequence('"merchants"', 'id'), COALESCE((SELECT MAX("id") FROM "merchants"), 1));
SELECT setval(pg_get_serial_sequence('"scanner_state"', 'id'), COALESCE((SELECT MAX("id") FROM "scanner_state"), 1));
SELECT setval(pg_get_serial_sequence('"panel_audit_logs"', 'id'), COALESCE((SELECT MAX("id") FROM "panel_audit_logs"), 1));
SELECT setval(pg_get_serial_sequence('"app_settings"', 'id'), COALESCE((SELECT MAX("id") FROM "app_settings"), 1));
SELECT setval(pg_get_serial_sequence('"merchant_settlements"', 'id'), COALESCE((SELECT MAX("id") FROM "merchant_settlements"), 1));
SELECT setval(pg_get_serial_sequence('"users"', 'id'), COALESCE((SELECT MAX("id") FROM "users"), 1));
SELECT setval(pg_get_serial_sequence('"wallets"', 'id'), COALESCE((SELECT MAX("id") FROM "wallets"), 1));
SELECT setval(pg_get_serial_sequence('"wallet_assignment_events"', 'id'), COALESCE((SELECT MAX("id") FROM "wallet_assignment_events"), 1));
SELECT setval(pg_get_serial_sequence('"transactions"', 'id'), COALESCE((SELECT MAX("id") FROM "transactions"), 1));
SELECT setval(pg_get_serial_sequence('"withdrawals"', 'id'), COALESCE((SELECT MAX("id") FROM "withdrawals"), 1));
SELECT setval(pg_get_serial_sequence('"audit_logs"', 'id'), COALESCE((SELECT MAX("id") FROM "audit_logs"), 1));
