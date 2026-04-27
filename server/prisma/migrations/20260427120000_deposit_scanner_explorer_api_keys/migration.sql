-- Multi-key pool for Etherscan (ERC20 deposit scan) and TronScan (TRC20 deposit scan).
CREATE TYPE "DepositScannerExplorerRail" AS ENUM ('erc20', 'trc20');

CREATE TABLE "deposit_scanner_explorer_api_keys" (
    "id" SERIAL NOT NULL,
    "rail" "DepositScannerExplorerRail" NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "api_key_cipher" TEXT NOT NULL,
    "api_key_hint" VARCHAR(24),
    "max_requests_per_day" INTEGER NOT NULL,
    "max_requests_per_second" INTEGER NOT NULL,
    "requests_today" INTEGER NOT NULL DEFAULT 0,
    "usage_day_utc" DATE NOT NULL DEFAULT '1970-01-01',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deposit_scanner_explorer_api_keys_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "deposit_scanner_explorer_api_keys_rail_is_active_sort_order_idx"
    ON "deposit_scanner_explorer_api_keys" ("rail", "is_active", "sort_order");
