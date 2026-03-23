-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Chain" AS ENUM ('ETH', 'BNB', 'POLYGON', 'ARBITRUM', 'OPTIMISM', 'TRON', 'BTC');

-- CreateEnum
CREATE TYPE "TxStatus" AS ENUM ('pending', 'success', 'failed');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "callback_url" TEXT,
    "account_index" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "chain" "Chain" NOT NULL,
    "derivation_index" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "tx_hash" TEXT NOT NULL,
    "from_address" TEXT NOT NULL,
    "to_address" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "token_symbol" TEXT NOT NULL,
    "chain" "Chain" NOT NULL,
    "status" "TxStatus" NOT NULL DEFAULT 'pending',
    "confirmations" INTEGER NOT NULL DEFAULT 0,
    "block_number" BIGINT,
    "log_index" INTEGER NOT NULL DEFAULT -1,
    "token_decimals" INTEGER NOT NULL DEFAULT 18,
    "callback_delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scanner_state" (
    "id" TEXT NOT NULL,
    "chain" "Chain" NOT NULL,
    "last_block" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scanner_state_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "users_account_index_key" ON "users"("account_index");
CREATE INDEX "wallets_chain_address_idx" ON "wallets"("chain", "address");
CREATE INDEX "wallets_address_idx" ON "wallets"("address");
CREATE UNIQUE INDEX "wallets_user_id_chain_key" ON "wallets"("user_id", "chain");
CREATE INDEX "transactions_to_address_chain_idx" ON "transactions"("to_address", "chain");
CREATE INDEX "transactions_status_idx" ON "transactions"("status");
CREATE UNIQUE INDEX "transactions_tx_hash_chain_wallet_id_token_symbol_log_index_key" ON "transactions"("tx_hash", "chain", "wallet_id", "token_symbol", "log_index");
CREATE UNIQUE INDEX "scanner_state_chain_key" ON "scanner_state"("chain");

ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
