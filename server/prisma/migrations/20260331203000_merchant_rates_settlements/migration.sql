-- AlterTable
ALTER TABLE "merchants" ADD COLUMN     "mdr_percent" DECIMAL(7,4) NOT NULL DEFAULT 0,
ADD COLUMN     "settlement_rate_percent" DECIMAL(7,4) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "merchant_settlements" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "environment" "MerchantGatewayEnv" NOT NULL,
    "chain" "Chain" NOT NULL,
    "token_symbol" TEXT NOT NULL,
    "token_decimals" INTEGER NOT NULL,
    "gross_amount" VARCHAR(128) NOT NULL,
    "mdr_percent" DECIMAL(7,4) NOT NULL,
    "settlement_rate_percent" DECIMAL(7,4) NOT NULL,
    "mdr_amount" VARCHAR(128) NOT NULL,
    "settlement_fee_amount" VARCHAR(128) NOT NULL,
    "net_amount" VARCHAR(128) NOT NULL,
    "proof_file_name" VARCHAR(512),
    "created_by_admin_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchant_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "merchant_settlements_merchant_id_environment_created_at_idx" ON "merchant_settlements"("merchant_id", "environment", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "merchant_settlements" ADD CONSTRAINT "merchant_settlements_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
