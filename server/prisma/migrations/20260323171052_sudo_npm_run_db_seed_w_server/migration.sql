-- AlterTable
ALTER TABLE "scanner_state" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "transactions" ALTER COLUMN "updated_at" DROP DEFAULT;
