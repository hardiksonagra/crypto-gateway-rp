import { re } from "crypto-payment-gateway/src/config/runtime-env.js";
import { logger } from "crypto-payment-gateway/src/lib/logger.js";
import { runAutomatedTronUsdtSweepRound } from "crypto-payment-gateway/src/services/sweep/tron-usdt-automated-sweep.js";

/**
 * Every N minutes (default 30): live TRON USDT·TRC20 deposit wallets, line by line —
 * if USDT ≥ `SWEEP_TRON_USDT_MIN_ATOMIC`, optionally top up TRX from `SWEEP_TRX_FUNDER_PRIVATE_KEY`,
 * then sweep USDT to `SWEEP_MASTER_TRON`. Structured logs on server logger.
 *
 * @param {{ schedule: (expression: string, handler: () => void, options?: object) => import('node-cron').ScheduledTask }} ctx
 */
export function registerTronUsdtAutoSweep(ctx) {
  if (!re.sweepTronAutoCronEnabled) {
    return;
  }

  const mins = Math.min(59, Math.max(1, re.sweepTronAutoCronMinutes));
  const cronExpr = `*/${mins} * * * *`;
  const opts = process.env.CRON_TZ ? { timezone: process.env.CRON_TZ } : undefined;

  ctx.schedule(
    cronExpr,
    () => {
      void (async () => {
        try {
          await runAutomatedTronUsdtSweepRound();
        } catch (e) {
          logger.error("tron_auto_sweep_cron_unhandled", {
            event: "tron_auto_sweep_cron_unhandled",
            at: new Date().toISOString(),
            err: String(e),
          });
        }
      })();
    },
    opts,
  );

  logger.info("cron_registered_tron_usdt_auto_sweep", {
    event: "cron_registered_tron_usdt_auto_sweep",
    cron_expression: cronExpr,
    interval_minutes: mins,
  });
}
