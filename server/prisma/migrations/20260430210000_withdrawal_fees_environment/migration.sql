-- Payout request fee snapshot (same sequential fee math as deposit settlement) + portal environment scope.

ALTER TABLE "withdrawals" ADD COLUMN "gross_amount" VARCHAR(128);
ALTER TABLE "withdrawals" ADD COLUMN "net_amount" VARCHAR(128);
ALTER TABLE "withdrawals" ADD COLUMN "mdr_amount" VARCHAR(128);
ALTER TABLE "withdrawals" ADD COLUMN "settlement_fee_amount" VARCHAR(128);
ALTER TABLE "withdrawals" ADD COLUMN "mdr_percent" DECIMAL(7, 4);
ALTER TABLE "withdrawals" ADD COLUMN "settlement_rate_percent" DECIMAL(7, 4);
ALTER TABLE "withdrawals" ADD COLUMN "token_decimals" INTEGER NOT NULL DEFAULT 6;
ALTER TABLE "withdrawals"
  ADD COLUMN "environment" "MerchantGatewayEnv" NOT NULL DEFAULT 'live';

UPDATE "withdrawals" SET "gross_amount" = "amount" WHERE "gross_amount" IS NULL;

CREATE INDEX "withdrawals_merchant_id_environment_status_idx"
  ON "withdrawals" ("merchant_id", "environment", "status");
