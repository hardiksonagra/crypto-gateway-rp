import { TxStatus } from "@prisma/client";
import { ACTIVE } from "../lib/active-row.js";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { re } from "../config/runtime-env.js";
import { prismaClientKnowsTxStatusCreated } from "../lib/prisma-tx-status.js";
import {
  findStaleCreatedCheckoutPlaceholderBatchRaw,
  markStaleCreatedCheckoutPlaceholderFailedRaw,
} from "../lib/checkout-created-expiry-prisma-raw.js";
import { releaseWalletAfterDepositSuccess } from "./wallet/wallet-service.js";
import { notifyPaymentFailed } from "./callback-service.js";

const DEFAULT_BATCH = 80;

/**
 * Mark stale unpaid checkout placeholders as `failed`, release the wallet reservation,
 * and enqueue the payment webhook (`notifyPaymentFailed`).
 *
 * Rows: `tx_hash` starts with `gateway-created:` and either `status: created`, or anomalous
 * `status: pending` with `amount` `0` (stuck placeholder). Does **not** fail real on-chain `pending`
 * deposits (different `tx_hash`).
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

  const stalePlaceholderWhere = {
    ...ACTIVE,
    createdAt: { lt: cutoff },
    txHash: { startsWith: "gateway-created:" },
    OR: [
      { status: TxStatus.created },
      {
        AND: [{ status: TxStatus.pending }, { amount: "0" }],
      },
    ],
  };

  const usePrismaCreatedEnum = prismaClientKnowsTxStatusCreated();
  if (!usePrismaCreatedEnum) {
    logger.warn("checkout_expiry_raw_sql_path", {
      event: "checkout_expiry_raw_sql_path",
      message:
        "Prisma client lacks TxStatus.created; using raw SQL for checkout expiry (gateway-created placeholders: created or pending+amount 0).",
    });
  }

  let totalExpired = 0;

  for (;;) {
    const stale = usePrismaCreatedEnum
      ? await prisma.transaction.findMany({
          where: stalePlaceholderWhere,
          select: { id: true, walletId: true },
          take: batchSize,
          orderBy: { createdAt: "asc" },
        })
      : await findStaleCreatedCheckoutPlaceholderBatchRaw(prisma, {
          cutoff,
          batchSize,
        });
    if (stale.length === 0) break;

    for (const row of stale) {
      const walletId = usePrismaCreatedEnum ? row.walletId : row.wallet_id;
      const updated = usePrismaCreatedEnum
        ? (
            await prisma.transaction.updateMany({
              where: {
                id: row.id,
                ...stalePlaceholderWhere,
              },
              data: { status: TxStatus.failed, updatedAt: new Date() },
            })
          ).count === 1
        : await markStaleCreatedCheckoutPlaceholderFailedRaw(prisma, {
            id: row.id,
            cutoff,
          });
      if (!updated) continue;
      totalExpired += 1;
      try {
        await releaseWalletAfterDepositSuccess(walletId);
      } catch (e) {
        logger.error("checkout_expiry_wallet_release_failed", {
          txId: row.id,
          walletId,
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
