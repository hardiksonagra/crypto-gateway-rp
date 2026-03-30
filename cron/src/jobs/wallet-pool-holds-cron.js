import { logger } from "crypto-payment-gateway/src/lib/logger.js";
import { releaseExpiredPoolHolds } from "../services/wallet-pool/wallet-pool-release.js";

/**
 * Periodically frees pooled wallets whose `hold_expires_at` is in the past (cron Node only).
 *
 * @param {{ schedule: (expression: string, handler: () => void, options?: object) => import('node-cron').ScheduledTask }} ctx
 */
export function registerWalletPoolExpiredHolds(ctx) {
  const opts = process.env.CRON_TZ ? { timezone: process.env.CRON_TZ } : undefined;

  ctx.schedule(
    "*/2 * * * *",
    () => {
      void (async () => {
        try {
          const n = await releaseExpiredPoolHolds();
          if (n > 0) {
            logger.info("wallet_pool_expired_holds_cleared", {
              event: "wallet_pool_expired_holds_cleared",
              wallets_updated: n,
            });
          }
        } catch (e) {
          logger.error("wallet_pool_expired_holds_tick_failed", {
            event: "wallet_pool_expired_holds_tick_failed",
            err: String(e),
          });
        }
      })();
    },
    opts,
  );

  logger.info("cron_registered_wallet_pool_expired_holds", {
    event: "cron_registered_wallet_pool_expired_holds",
    schedule: "*/2 * * * *",
  });
}
