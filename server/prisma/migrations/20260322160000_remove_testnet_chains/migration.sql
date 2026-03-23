-- Remove Sepolia / Goerli from Chain enum (testnet cleanup)
DELETE FROM "transactions" WHERE "chain"::text IN ('SEPOLIA', 'GOERLI');
DELETE FROM "wallets" WHERE "chain"::text IN ('SEPOLIA', 'GOERLI');
DELETE FROM "scanner_state" WHERE "chain"::text IN ('SEPOLIA', 'GOERLI');

CREATE TYPE "Chain_new" AS ENUM ('ETH', 'BNB', 'POLYGON', 'ARBITRUM', 'OPTIMISM', 'TRON', 'BTC');

ALTER TABLE "wallets" ALTER COLUMN "chain" TYPE "Chain_new" USING ("chain"::text::"Chain_new");
ALTER TABLE "transactions" ALTER COLUMN "chain" TYPE "Chain_new" USING ("chain"::text::"Chain_new");
ALTER TABLE "scanner_state" ALTER COLUMN "chain" TYPE "Chain_new" USING ("chain"::text::"Chain_new");

DROP TYPE "Chain";
ALTER TYPE "Chain_new" RENAME TO "Chain";
