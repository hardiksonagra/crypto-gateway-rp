import { registerExampleHeartbeat } from "./example-heartbeat.js";
import { registerWalletPoolExpiredHolds } from "./wallet-pool-holds-cron.js";

/**
 * PM2 `crypto-gateway-cron-maintenance` — heartbeat + wallet-pool holds only.
 * Full deposit scan: dedicated app `crypto-gateway-cron-deposit-full-scan`.
 *
 * @param {{ schedule: (expression: string, handler: () => void, options?: object) => import("node-cron").ScheduledTask }} ctx
 */
export function registerCronGroup1(ctx) {
  registerExampleHeartbeat(ctx);
  registerWalletPoolExpiredHolds(ctx);
}
