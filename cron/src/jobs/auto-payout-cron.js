import { logger } from "crypto-payment-gateway/src/lib/logger.js";
import { processPendingAutoPayouts } from "crypto-payment-gateway/src/services/payout/execute-auto-payout.js";

/**
 * Every minute: execute leftover `pending` payouts + fail stuck `processing` without tx_hash.
 *
 * @param {{ schedule: (expression: string, handler: () => void, options?: object) => import("node-cron").ScheduledTask }} ctx
 */
export function registerAutoPayoutCron(ctx) {
  const opts = process.env.CRON_TZ ? { timezone: process.env.CRON_TZ } : undefined;

  ctx.schedule(
    "* * * * *",
    () => {
      void (async () => {
        try {
          const r = await processPendingAutoPayouts({ limit: 10 });
          if (
            r.pending_attempted > 0 ||
            r.stuck_marked_failed > 0
          ) {
            logger.info("auto_payout_cron_tick", {
              event: "auto_payout_cron_tick",
              ...r,
            });
          }
        } catch (e) {
          logger.error("auto_payout_cron_unhandled", {
            event: "auto_payout_cron_unhandled",
            at: new Date().toISOString(),
            err: String(e),
          });
        }
      })();
    },
    opts,
  );

  logger.info("cron_registered_auto_payout", {
    event: "cron_registered_auto_payout",
    cron_expression: "* * * * *",
  });
}
