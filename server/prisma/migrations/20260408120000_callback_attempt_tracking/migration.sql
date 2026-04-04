-- AlterTable
ALTER TABLE "transactions" ADD COLUMN "callback_attempt_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "transactions" ADD COLUMN "callback_last_attempt_at" TIMESTAMP(3);
