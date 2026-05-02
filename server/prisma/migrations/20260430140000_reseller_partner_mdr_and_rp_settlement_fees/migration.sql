ALTER TABLE "reseller_partners" ADD COLUMN IF NOT EXISTS "mdr_percent" DECIMAL(7,4) NOT NULL DEFAULT 0;

UPDATE "merchants"
SET "settlement_rate_percent" = 0
WHERE "reseller_partner_id" IS NOT NULL;
