import { re } from "crypto-payment-gateway/src/config/runtime-env.js";
import { loadAppSettingsFromDatabase } from "crypto-payment-gateway/src/lib/app-settings-runtime.js";
import { logger } from "crypto-payment-gateway/src/lib/logger.js";
import { expireStaleCreatedCheckoutTransactions } from "crypto-payment-gateway/src/services/checkout-session-expiry.js";

/**
 * Marks fixed-amount checkout placeholders (`status: created`) as `failed` after
 * {@link re.checkoutCreatedExpiryHours} and sends `status: failed` payment webhooks.
 * Interval: {@link re.checkoutExpiryCronMinutes} (default 30), env / Admin.
 *
 * @param {{ schedule: (expression: string, handler: () => void, options?: object) => import("node-cron").ScheduledTask }} ctx
 */
export function registerCheckoutCreatedExpiryCron(ctx) {
  const opts = process.env.CRON_TZ ? { timezone: process.env.CRON_TZ } : undefined;
  const mins = re.checkoutExpiryCronMinutes;
  const cronExpr = `*/${mins} * * * *`;

  ctx.schedule(
    cronExpr,
    () => {
      void (async () => {
        try {
          try {
            await loadAppSettingsFromDatabase();
          } catch {
            /* ignore: next tick retries */
          }
          await expireStaleCreatedCheckoutTransactions();
        } catch (e) {
          logger.error("checkout_created_expiry_tick_failed", {
            event: "checkout_created_expiry_tick_failed",
            err: String(e),
          });
        }
      })();
    },
    opts,
  );

  logger.info("cron_registered_checkout_created_expiry", {
    event: "cron_registered_checkout_created_expiry",
    cron_expression: cronExpr,
    interval_minutes: mins,
  });
}
