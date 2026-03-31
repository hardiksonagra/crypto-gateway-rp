-- AlterTable
ALTER TABLE "merchant_settlements" ADD COLUMN "transaction_count" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN "merchant_settlement_id" TEXT;

-- CreateIndex
CREATE INDEX "transactions_merchant_settlement_id_idx" ON "transactions"("merchant_settlement_id");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_merchant_settlement_id_fkey" FOREIGN KEY ("merchant_settlement_id") REFERENCES "merchant_settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
