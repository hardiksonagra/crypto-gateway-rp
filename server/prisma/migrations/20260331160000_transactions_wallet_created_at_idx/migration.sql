-- Speed up transaction lists scoped by wallet + time ordering (gateway API, portal).
CREATE INDEX "transactions_wallet_id_created_at_idx" ON "transactions" ("wallet_id", "created_at" DESC);
