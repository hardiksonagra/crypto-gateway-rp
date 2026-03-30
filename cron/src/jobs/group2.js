import { registerTronUsdtAutoSweep } from "./tron-usdt-auto-sweep-cron.js";

/**
 * PM2 `crypto-gateway-cron-tron-sweep` — TRON USDT sweep and similar jobs.
 *
 * @param {{ schedule: (expression: string, handler: () => void, options?: object) => import("node-cron").ScheduledTask }} ctx
 */
export function registerCronGroup2(ctx) {
  registerTronUsdtAutoSweep(ctx);
}
