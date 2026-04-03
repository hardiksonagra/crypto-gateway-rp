-- Per-checkout session key: assignment event + successful transaction; payment link token carries the key for poll/redirect matching.
ALTER TABLE "wallet_assignment_events" ADD COLUMN "deposit_session_key" VARCHAR(64);

ALTER TABLE "transactions" ADD COLUMN "deposit_session_key" VARCHAR(64);

CREATE INDEX "transactions_wallet_id_deposit_session_key_idx" ON "transactions" ("wallet_id", "deposit_session_key");
