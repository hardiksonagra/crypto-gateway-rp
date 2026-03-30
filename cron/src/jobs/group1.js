import { registerExampleHeartbeat } from "./example-heartbeat.js";
import { registerWalletPoolExpiredHolds } from "./wallet-pool-holds-cron.js";

/**
 * PM2 `crypto-gateway-cron-1` — maintenance-style schedules.
 *
 * @param {{ schedule: (expression: string, handler: () => void, options?: object) => import("node-cron").ScheduledTask }} ctx
 */
export function registerCronGroup1(ctx) {
  registerExampleHeartbeat(ctx);
  registerWalletPoolExpiredHolds(ctx);
}
