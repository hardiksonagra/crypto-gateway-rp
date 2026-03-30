ALTER TABLE "wallets" ADD COLUMN "cached_balance_display" VARCHAR(256),
ADD COLUMN "cached_balance_atomic" VARCHAR(128),
ADD COLUMN "cached_balance_error" VARCHAR(512),
ADD COLUMN "cached_balance_updated_at" TIMESTAMP(3);
