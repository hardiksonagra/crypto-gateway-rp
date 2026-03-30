import { registerExampleHeartbeat } from "./example-heartbeat.js";
import { registerTronUsdtAutoSweep } from "./tron-usdt-auto-sweep-cron.js";
import { registerWalletPoolExpiredHolds } from "./wallet-pool-holds-cron.js";

/**
 * Wire all cron jobs here. Each job module calls `schedule()` from this package’s runner.
 * All `node-cron` schedules run only in the **crypto-gateway-cron** Node process (see `ecosystem.config.cjs`).
 *
 * @param {{ schedule: (expression: string, handler: () => void, options?: object) => import('node-cron').ScheduledTask }} ctx
 */
export function registerJobs(ctx) {
  registerExampleHeartbeat(ctx);
  registerWalletPoolExpiredHolds(ctx);
  registerTronUsdtAutoSweep(ctx);
}
