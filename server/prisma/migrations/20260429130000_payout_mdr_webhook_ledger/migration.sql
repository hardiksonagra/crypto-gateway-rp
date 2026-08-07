-- Payout MDR (separate from deposit MDR); withdrawal webhook delivery tracking.

ALTER TABLE "merchants" ADD COLUMN "payout_mdr_percent" DECIMAL(7, 4) NOT NULL DEFAULT 0;
UPDATE "merchants" SET "payout_mdr_percent" = "mdr_percent";

ALTER TABLE "withdrawals" ADD COLUMN "callback_delivered_at" TIMESTAMPTZ;
ALTER TABLE "withdrawals" ADD COLUMN "callback_attempt_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "withdrawals" ADD COLUMN "callback_last_attempt_at" TIMESTAMPTZ;
