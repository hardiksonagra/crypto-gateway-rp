import { TxStatus } from "@prisma/client";
import { ACTIVE } from "../lib/active-row.js";
import { TX_STATUS_UNDERPAID } from "../lib/prisma-tx-status.js";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import {
  notifyPaymentSuccess,
  notifyPaymentUnderpaid,
} from "./callback-service.js";
import {
  CALLBACK_RETRY_MIN_INTERVAL_MS,
  MAX_AUTO_CALLBACK_ATTEMPTS,
} from "./callback-service.js";

/**
 * Retry payment webhooks (`X-Webhook-Event: payment`, body `status: success`) that never got 2xx, up to {@link MAX_AUTO_CALLBACK_ATTEMPTS}
 * tries total, at most one eligible row per {@link CALLBACK_RETRY_MIN_INTERVAL_MS} per transaction.
 *
 * @param {number} [limit]
 */
export async function retryStuckSuccessCallbacks(limit = 30) {
  const minAgo = new Date(Date.now() - CALLBACK_RETRY_MIN_INTERVAL_MS);
  const rows = await prisma.transaction.findMany({
    where: {
      ...ACTIVE,
      status: TxStatus.success,
      callbackDeliveredAt: null,
      callbackAttemptCount: { lt: MAX_AUTO_CALLBACK_ATTEMPTS },
      wallet: {
        is: {
          ...ACTIVE,
          merchant: { ...ACTIVE, callbackUrl: { not: null } },
        },
      },
      OR: [{ callbackAttemptCount: 0 }, { callbackLastAttemptAt: { lte: minAgo } }],
    },
    select: { id: true },
    take: limit,
    orderBy: { updatedAt: "asc" },
  });
  for (const r of rows) {
    try {
      await notifyPaymentSuccess(r.id);
    } catch (e) {
      logger.error("retry callback tick failed", { txId: r.id, err: String(e) });
    }
  }
}

/**
 * Same retry policy as {@link retryStuckSuccessCallbacks} for underpaid rows (`status: underpaid` in JSON body).
 *
 * @param {number} [limit]
 */
export async function retryStuckUnderpaidCallbacks(limit = 30) {
  const minAgo = new Date(Date.now() - CALLBACK_RETRY_MIN_INTERVAL_MS);
  const rows = await prisma.transaction.findMany({
    where: {
      ...ACTIVE,
      status: TX_STATUS_UNDERPAID,
      callbackDeliveredAt: null,
      callbackAttemptCount: { lt: MAX_AUTO_CALLBACK_ATTEMPTS },
      wallet: {
        is: {
          ...ACTIVE,
          merchant: { ...ACTIVE, callbackUrl: { not: null } },
        },
      },
      OR: [{ callbackAttemptCount: 0 }, { callbackLastAttemptAt: { lte: minAgo } }],
    },
    select: { id: true },
    take: limit,
    orderBy: { updatedAt: "asc" },
  });
  for (const r of rows) {
    try {
      await notifyPaymentUnderpaid(r.id);
    } catch (e) {
      logger.error("retry underpaid callback tick failed", {
        txId: r.id,
        err: String(e),
      });
    }
  }
}
