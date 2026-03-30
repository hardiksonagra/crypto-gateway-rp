-- Wallet pool: merchant-scoped reusable addresses + optional timed hold.
-- Transactions store payer user for callbacks after wallet is released back to the pool.

ALTER TABLE "wallets" ADD COLUMN "merchant_id" TEXT;
ALTER TABLE "wallets" ADD COLUMN "environment" "MerchantGatewayEnv";
ALTER TABLE "wallets" ADD COLUMN "assigned_user_id" TEXT;
ALTER TABLE "wallets" ADD COLUMN "hold_expires_at" TIMESTAMP(3);

UPDATE "wallets" w
SET
  "merchant_id" = u."merchant_id",
  "environment" = u."environment",
  "assigned_user_id" = w."user_id"
FROM "users" u
WHERE w."user_id" = u."id";

ALTER TABLE "transactions" ADD COLUMN "payer_user_id" TEXT;

UPDATE "transactions" t
SET "payer_user_id" = w."user_id"
FROM "wallets" w
WHERE t."wallet_id" = w."id";

ALTER TABLE "wallets" DROP CONSTRAINT IF EXISTS "wallets_user_id_fkey";

DROP INDEX IF EXISTS "wallets_user_id_chain_currency_network_key";

ALTER TABLE "wallets" DROP COLUMN "user_id";

ALTER TABLE "wallets" ALTER COLUMN "merchant_id" SET NOT NULL;
ALTER TABLE "wallets" ALTER COLUMN "environment" SET NOT NULL;

CREATE UNIQUE INDEX "wallets_merchant_id_environment_chain_currency_network_address_key"
  ON "wallets"("merchant_id", "environment", "chain", "currency", "network", "address");

CREATE INDEX "wallets_merchant_id_environment_chain_currency_network_idx"
  ON "wallets"("merchant_id", "environment", "chain", "currency", "network");

CREATE INDEX "wallets_assigned_user_id_idx" ON "wallets"("assigned_user_id");
CREATE INDEX "wallets_hold_expires_at_idx" ON "wallets"("hold_expires_at");

ALTER TABLE "wallets"
  ADD CONSTRAINT "wallets_merchant_id_fkey"
  FOREIGN KEY ("merchant_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "wallets"
  ADD CONSTRAINT "wallets_assigned_user_id_fkey"
  FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_payer_user_id_fkey"
  FOREIGN KEY ("payer_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "transactions_payer_user_id_idx" ON "transactions"("payer_user_id");
