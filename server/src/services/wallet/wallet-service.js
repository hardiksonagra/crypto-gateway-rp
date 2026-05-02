/**
 * Wallet assignment lives under `cron/src/services/wallet-pool/` so one codebase owns rules.
 * - `assignPooledWalletForDeposit` — API `deposit-address`: one dedicated wallet per end-user per rail; reuse same
 *   address on repeat calls; pool rows are only used when still unassigned (`assigned_user_id` null).
 * - `releaseWalletAfterDepositSuccess` — clears checkout TTLs only; keeps `assigned_user_id` (terminal deposit / expiry).
 * - Expired-hold cleanup in **crypto-gateway-cron-maintenance** (`wallet-pool-holds-cron.js`) clears stale TTLs only.
 */
export { assignPooledWalletForDeposit } from "../../../../cron/src/services/wallet-pool/assign-pooled-wallet.js";
export { releaseWalletAfterDepositSuccess } from "../../../../cron/src/services/wallet-pool/wallet-pool-release.js";
