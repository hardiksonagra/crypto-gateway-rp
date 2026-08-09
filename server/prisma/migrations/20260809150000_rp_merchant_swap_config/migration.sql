-- RP portal: one active swap-to-main-wallet config per merchant
CREATE TABLE "rp_merchant_swap_configs" (
    "id" SERIAL NOT NULL,
    "reseller_partner_id" INTEGER NOT NULL,
    "merchant_id" INTEGER NOT NULL,
    "tron_address" VARCHAR(128) NOT NULL,
    "min_amount_human" VARCHAR(128) NOT NULL DEFAULT '0',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rp_merchant_swap_configs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "rp_merchant_swap_configs_reseller_partner_id_deleted_at_idx" ON "rp_merchant_swap_configs"("reseller_partner_id", "deleted_at");

CREATE INDEX "rp_merchant_swap_configs_merchant_id_idx" ON "rp_merchant_swap_configs"("merchant_id");

CREATE UNIQUE INDEX "rp_merchant_swap_configs_merchant_id_active_key" ON "rp_merchant_swap_configs"("merchant_id") WHERE "deleted_at" IS NULL;

ALTER TABLE "rp_merchant_swap_configs" ADD CONSTRAINT "rp_merchant_swap_configs_reseller_partner_id_fkey" FOREIGN KEY ("reseller_partner_id") REFERENCES "reseller_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "rp_merchant_swap_configs" ADD CONSTRAINT "rp_merchant_swap_configs_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
