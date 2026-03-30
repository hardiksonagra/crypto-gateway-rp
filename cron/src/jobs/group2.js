import { registerTronUsdtAutoSweep } from "./tron-usdt-auto-sweep-cron.js";

/**
 * PM2 `crypto-gateway-cron-2` — chain-heavy / sweep schedules.
 *
 * @param {{ schedule: (expression: string, handler: () => void, options?: object) => import("node-cron").ScheduledTask }} ctx
 */
export function registerCronGroup2(ctx) {
  registerTronUsdtAutoSweep(ctx);
}
