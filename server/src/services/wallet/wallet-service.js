/**
 * Wallet pool logic lives under `cron/src/services/wallet-pool/` so one codebase owns pool rules.
 * - `assignPooledWalletForDeposit` is **invoked from the API** on deposit-address requests (must stay synchronous with HTTP).
 * - `releaseWalletAfterDepositSuccess` runs from `transaction-upsert` (scanner in cron, or sandbox on API).
 * - Expired-hold cleanup runs on a timer only inside **crypto-gateway-cron-1** (`wallet-pool-holds-cron.js`).
 */
export { assignPooledWalletForDeposit } from "../../../../cron/src/services/wallet-pool/assign-pooled-wallet.js";
export { releaseWalletAfterDepositSuccess } from "../../../../cron/src/services/wallet-pool/wallet-pool-release.js";
