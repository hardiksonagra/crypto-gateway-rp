-- Keep one row per (chain, tx_hash, log_index). Removes duplicate credits across wallet_id / token rows.
DELETE FROM "transactions" t
USING "transactions" t2
WHERE t."id" > t2."id"
  AND t."chain" = t2."chain"
  AND t."tx_hash" = t2."tx_hash"
  AND t."log_index" = t2."log_index";

DROP INDEX IF EXISTS "tx_dedupe";
DROP INDEX IF EXISTS "transactions_tx_hash_chain_token_symbol_log_index_idx";

CREATE UNIQUE INDEX "tx_chain_log_unique" ON "transactions"("chain", "tx_hash", "log_index");
