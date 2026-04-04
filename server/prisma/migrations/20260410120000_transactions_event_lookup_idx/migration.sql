-- Speeds findMany by (tx_hash, chain, token_symbol, log_index) for deposit dedupe.
CREATE INDEX "transactions_tx_hash_chain_token_symbol_log_index_idx" ON "transactions"("tx_hash", "chain", "token_symbol", "log_index");
