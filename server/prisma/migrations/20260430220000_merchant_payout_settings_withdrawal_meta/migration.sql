-- Merchant-configurable payout limits + treasury hints; withdrawal API correlation.

ALTER TABLE "merchants" ADD COLUMN "payout_min_amount_human" VARCHAR(128) NOT NULL DEFAULT '0';
ALTER TABLE "merchants" ADD COLUMN "payout_max_amount_human" VARCHAR(128) NOT NULL DEFAULT '0';
ALTER TABLE "merchants" ADD COLUMN "payout_treasury_addresses_json" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "withdrawals" ADD COLUMN "client_reference_id" VARCHAR(256);
ALTER TABLE "withdrawals" ADD COLUMN "source" VARCHAR(24) NOT NULL DEFAULT 'portal';

CREATE UNIQUE INDEX "withdrawals_merchant_env_client_ref_unique"
  ON "withdrawals" ("merchant_id", "environment", "client_reference_id")
  WHERE "client_reference_id" IS NOT NULL AND "deleted_at" IS NULL;
