-- One-shot “restart deposit scan” flag (cleared after the worker processes a tick).
ALTER TABLE "wallets" ADD COLUMN "deposit_scan_single_tick_requested" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "wallets_deposit_scan_single_tick_requested_idx" ON "wallets"("deposit_scan_single_tick_requested");
