-- On-chain network fee (native TRX / ETH) for completed payout txs; populated from RPC when tx_hash is known.
ALTER TABLE "withdrawals" ADD COLUMN "network_fee_native_atomic" VARCHAR(128);
ALTER TABLE "withdrawals" ADD COLUMN "network_fee_native_symbol" VARCHAR(16);
ALTER TABLE "withdrawals" ADD COLUMN "network_fee_fetched_at" TIMESTAMPTZ;
