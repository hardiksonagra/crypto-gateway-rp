-- Default payout MDR for merchants created under this RP (can differ from deposit MDR).
ALTER TABLE "reseller_partners" ADD COLUMN "payout_mdr_percent" DECIMAL(7, 4) NOT NULL DEFAULT 0;
UPDATE "reseller_partners" SET "payout_mdr_percent" = "mdr_percent";
