import { registerExampleHeartbeat } from "./example-heartbeat.js";
import { registerCheckoutCreatedExpiryCron } from "./checkout-created-expiry-cron.js";
import { registerWalletPoolExpiredHolds } from "./wallet-pool-holds-cron.js";
import { registerAutoPayoutCron } from "./auto-payout-cron.js";

/**
 * PM2 `crypto-gateway-cron-maintenance` — heartbeat + wallet-pool holds + stale checkout expiry + auto-payout drain.
 * Full deposit scan: dedicated app `crypto-gateway-cron-deposit-full-scan`.
 *
 * @param {{ schedule: (expression: string, handler: () => void, options?: object) => import("node-cron").ScheduledTask }} ctx
 */
export function registerCronGroup1(ctx) {
  registerExampleHeartbeat(ctx);
  registerWalletPoolExpiredHolds(ctx);
  registerCheckoutCreatedExpiryCron(ctx);
  registerAutoPayoutCron(ctx);
}
