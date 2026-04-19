-- AlterEnum
ALTER TYPE "TxStatus" ADD VALUE 'underpaid';

-- AlterTable
ALTER TABLE "wallet_assignment_events" ADD COLUMN "expected_amount_atomic" VARCHAR(128);
