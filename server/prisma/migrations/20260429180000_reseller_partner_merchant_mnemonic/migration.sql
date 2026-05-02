-- Reseller partners (RP portal) + per-merchant encrypted mnemonic for HD deposit addresses.

CREATE TABLE "reseller_partners" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reseller_partners_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "reseller_partners_deleted_at_idx" ON "reseller_partners"("deleted_at");

ALTER TABLE "merchants" ADD COLUMN "reseller_partner_id" INTEGER;
ALTER TABLE "merchants" ADD COLUMN "mnemonic_cipher" TEXT;

CREATE INDEX "merchants_reseller_partner_id_idx" ON "merchants"("reseller_partner_id");

ALTER TABLE "merchants" ADD CONSTRAINT "merchants_reseller_partner_id_fkey"
  FOREIGN KEY ("reseller_partner_id") REFERENCES "reseller_partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;
