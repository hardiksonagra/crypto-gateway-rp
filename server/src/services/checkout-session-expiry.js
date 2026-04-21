import { TxStatus } from "@prisma/client";
import { ACTIVE } from "../lib/active-row.js";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { re } from "../config/runtime-env.js";
import { releaseWalletAfterDepositSuccess } from "./wallet/wallet-service.js";
import { notifyPaymentFailed } from "./callback-service.js";

const DEFAULT_BATCH = 80;

/**
 * Mark stale `created` checkout placeholder rows as `failed`, release the wallet reservation,
 * and enqueue the payment webhook (`notifyPaymentFailed`).
 *
 * Placeholder rows: one `created` transaction per `deposit-address` call (see
 * assign-pooled-wallet), with or without optional fixed `amount`.
 *
 * @param {{ batchSize?: number }} [opts]
 * @returns {Promise<number>} number of rows transitioned to `failed`
 */
export async function expireStaleCreatedCheckoutTransactions(opts = {}) {
  const hours = re.checkoutCreatedExpiryHours;
  const olderThanMs = Math.max(1, hours) * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - olderThanMs);
  const batchSize =
    typeof opts.batchSize === "number" && opts.batchSize > 0
      ? Math.min(500, opts.batchSize)
      : DEFAULT_BATCH;

  let totalExpired = 0;

  for (;;) {
    const stale = await prisma.transaction.findMany({
      where: {
        ...ACTIVE,
        status: TxStatus.created,
        createdAt: { lt: cutoff },
      },
      select: { id: true, walletId: true },
      take: batchSize,
      orderBy: { createdAt: "asc" },
    });
    if (stale.length === 0) break;

    for (const row of stale) {
      const upd = await prisma.transaction.updateMany({
        where: {
          id: row.id,
          ...ACTIVE,
          status: TxStatus.created,
          createdAt: { lt: cutoff },
        },
        data: { status: TxStatus.failed, updatedAt: new Date() },
      });
      if (upd.count !== 1) continue;
      totalExpired += 1;
      try {
        await releaseWalletAfterDepositSuccess(row.walletId);
      } catch (e) {
        logger.error("checkout_expiry_wallet_release_failed", {
          txId: row.id,
          walletId: row.walletId,
          err: String(e),
        });
      }
      try {
        await notifyPaymentFailed(row.id, {
          failureReason: "checkout_expired_unpaid",
        });
      } catch (e) {
        logger.error("checkout_expiry_notify_failed", {
          txId: row.id,
          err: String(e),
        });
      }
    }
  }

  if (totalExpired > 0) {
    logger.info("checkout_created_expired_batch", {
      event: "checkout_created_expired_batch",
      expired_count: totalExpired,
      older_than_hours: hours,
      cutoff_iso: cutoff.toISOString(),
    });
  }
  return totalExpired;
}
