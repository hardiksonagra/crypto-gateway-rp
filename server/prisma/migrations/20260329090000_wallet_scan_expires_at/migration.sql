-- AlterTable
ALTER TABLE "wallets" ADD COLUMN "scan_expires_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "wallets_scan_expires_at_idx" ON "wallets"("scan_expires_at");
