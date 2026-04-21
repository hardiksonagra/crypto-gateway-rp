import { TxStatus } from "@prisma/client";
import { ACTIVE } from "../lib/active-row.js";
import { prismaClientKnowsTxStatusUnderpaid } from "../lib/prisma-tx-status.js";
import { findUnderpaidCallbackRetryIdsRaw } from "../lib/underpaid-prisma-raw.js";
import { prisma } from "../lib/prisma.js";
import { coerceTransactionPrimaryKey } from "../lib/entity-internal-id.js";
import { logger } from "../lib/logger.js";
import {
  notifyPaymentFailed,
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
      const id = coerceTransactionPrimaryKey(r.id);
      if (id != null) await notifyPaymentSuccess(id);
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
/**
 * Retry payment webhooks for `status: failed` (e.g. expired checkout) until 2xx or max attempts.
 *
 * @param {number} [limit]
 */
export async function retryStuckFailedCallbacks(limit = 30) {
  const minAgo = new Date(Date.now() - CALLBACK_RETRY_MIN_INTERVAL_MS);
  const rows = await prisma.transaction.findMany({
    where: {
      ...ACTIVE,
      status: TxStatus.failed,
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
      const id = coerceTransactionPrimaryKey(r.id);
      if (id != null) await notifyPaymentFailed(id);
    } catch (e) {
      logger.error("retry failed callback tick failed", { txId: r.id, err: String(e) });
    }
  }
}

export async function retryStuckUnderpaidCallbacks(limit = 30) {
  const minAgo = new Date(Date.now() - CALLBACK_RETRY_MIN_INTERVAL_MS);
  const rows = prismaClientKnowsTxStatusUnderpaid()
    ? await prisma.transaction.findMany({
        where: {
          ...ACTIVE,
          status: TxStatus.underpaid,
          callbackDeliveredAt: null,
          callbackAttemptCount: { lt: MAX_AUTO_CALLBACK_ATTEMPTS },
          wallet: {
            is: {
              ...ACTIVE,
              merchant: { ...ACTIVE, callbackUrl: { not: null } },
            },
          },
          OR: [
            { callbackAttemptCount: 0 },
            { callbackLastAttemptAt: { lte: minAgo } },
          ],
        },
        select: { id: true },
        take: limit,
        orderBy: { updatedAt: "asc" },
      })
    : await findUnderpaidCallbackRetryIdsRaw(prisma, {
        limit,
        minAgo,
        maxAttempts: MAX_AUTO_CALLBACK_ATTEMPTS,
      });
  for (const r of rows) {
    try {
      const id = coerceTransactionPrimaryKey(r.id);
      if (id != null) await notifyPaymentUnderpaid(id);
    } catch (e) {
      logger.error("retry underpaid callback tick failed", {
        txId: r.id,
        err: String(e),
      });
    }
  }
}
