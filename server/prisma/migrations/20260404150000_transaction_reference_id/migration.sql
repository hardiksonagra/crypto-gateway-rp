-- Merchant-provided checkout / order reference (gateway JSON `transaction_id`).
ALTER TABLE "wallet_assignment_events" ADD COLUMN "reference_transaction_id" VARCHAR(256);

ALTER TABLE "transactions" ADD COLUMN "transaction_id" VARCHAR(256);

CREATE INDEX "transactions_referenceTransactionId_idx" ON "transactions"("transaction_id");
