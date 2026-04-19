import axios from "axios";
import { TxStatus } from "@prisma/client";
import {
  prismaClientKnowsTxStatusUnderpaid,
  TX_STATUS_UNDERPAID,
} from "../lib/prisma-tx-status.js";
import { claimUnderpaidWebhookAttemptRaw } from "../lib/underpaid-prisma-raw.js";
import { formatAtomicAmountString } from "../lib/format-atomic-amount.js";
import { ACTIVE } from "../lib/active-row.js";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import {
  logPaymentSuccessCallback,
  logPaymentUnderpaidCallback,
  writeAuditLog,
} from "./audit-log.js";
import {
  resolveTransactionInternalId,
  transactionWhereFromRouteParam,
} from "../lib/entity-internal-id.js";
import { expectedAtomicForDepositSession } from "../lib/expected-deposit-amount.js";

/**
 * HTTP `X-Webhook-Event` for every automatic and manual payment callback.
 * Branch on JSON `status` (`success`, `underpaid`, `pending`, `failed`) and on
 * optional `expected_amount_*` / `received_amount_*` when present.
 */
export const PAYMENT_WEBHOOK_EVENT = "payment";

/** Max automatic payment webhook POST attempts per transaction (first try counts as one). */
export const MAX_AUTO_CALLBACK_ATTEMPTS = 5;

/** Minimum milliseconds between automatic webhook attempts after a failed try. */
export const CALLBACK_RETRY_MIN_INTERVAL_MS = 60_000;

/**
 * @param {import("@prisma/client").Transaction & {
 *   wallet: import("@prisma/client").Wallet & { merchant: import("@prisma/client").Merchant },
 *   payerUser: (import("@prisma/client").User & { merchant: import("@prisma/client").Merchant }) | null,
 * }} tx
 * @returns {Record<string, unknown>}
 */
export function buildPaymentSuccessWebhookBody(tx) {
  const u = tx.payerUser;
  const merchant = u?.merchant ?? tx.wallet.merchant;
  return {
    transaction_id: tx.id,
    merchant_transaction_id: tx.referenceTransactionId ?? null,
    wallet_id: tx.walletId,
    tx_hash: tx.txHash,
    amount: tx.amount,
    token_decimals: tx.tokenDecimals,
    amount_decimal: formatAtomicAmountString(tx.amount, tx.tokenDecimals),
    status: tx.status,
    chain: tx.chain,
    currency: tx.wallet.currency,
    network: tx.wallet.network,
    token_symbol: tx.tokenSymbol,
    wallet_address: tx.wallet.address,
    confirmations: tx.confirmations,
    external_user_id: u?.externalUserId ?? "",
    merchant_id: merchant.id,
    gateway_environment: u?.environment ?? tx.wallet.environment,
  };
}

/**
 * @param {import("@prisma/client").Transaction & {
 *   wallet: import("@prisma/client").Wallet & { merchant: import("@prisma/client").Merchant },
 *   payerUser: (import("@prisma/client").User & { merchant: import("@prisma/client").Merchant }) | null,
 * }} tx
 * @param {string} expectedAtomic
 */
export function buildPaymentUnderpaidWebhookBody(tx, expectedAtomic) {
  const base = buildPaymentSuccessWebhookBody(tx);
  return {
    ...base,
    expected_amount_atomic: expectedAtomic,
    expected_amount_decimal: formatAtomicAmountString(
      expectedAtomic,
      tx.tokenDecimals,
    ),
    received_amount_atomic: base.amount,
    received_amount_decimal: base.amount_decimal,
  };
}

function axiosErrDetail(e) {
  if (axios.isAxiosError(e)) {
    return {
      status: e.response?.status,
      statusText: e.response?.statusText,
      body:
        typeof e.response?.data === "string"
          ? e.response.data.slice(0, 500)
          : JSON.stringify(e.response?.data ?? "").slice(0, 500),
    };
  }
  return {};
}

export async function notifyPaymentSuccess(txId) {
  const tid = await resolveTransactionInternalId(txId);
  if (tid == null) {
    logger.warn("callback skip: tx not found", { txId });
    return;
  }
  const tx = await prisma.transaction.findFirst({
    where: { id: tid, ...ACTIVE },
    include: {
      wallet: { include: { merchant: true } },
      payerUser: { include: { merchant: true } },
    },
  });
  if (!tx) {
    logger.warn("callback skip: tx not found", { txId });
    return;
  }
  if (tx.callbackDeliveredAt) return;
  if (tx.status !== "success") {
    logger.debug("callback skip: tx not success yet", {
      txId,
      status: tx.status,
      confirmations: tx.confirmations,
    });
    return;
  }
  const merchant = tx.payerUser?.merchant ?? tx.wallet.merchant;
  const url = merchant.callbackUrl;
  const body = buildPaymentSuccessWebhookBody(tx);
  if (!url) {
    logger.warn("callback skip: merchant has no callback_url (set in portal)", {
      txId,
      payerUserId: tx.payerUserId,
      merchantId: merchant.id,
    });
    logPaymentSuccessCallback({
      merchantId: merchant.id,
      transactionId: tid,
      url: null,
      requestBody: body,
      ok: false,
      httpStatus: null,
      responseSnippet: "skipped: callback_url not configured",
      trigger: "skipped",
    });
    return;
  }

  const throttleSince = new Date(Date.now() - CALLBACK_RETRY_MIN_INTERVAL_MS);
  const claimed = await prisma.transaction.updateMany({
    where: {
      id: tid,
      ...ACTIVE,
      status: TxStatus.success,
      callbackDeliveredAt: null,
      callbackAttemptCount: { lt: MAX_AUTO_CALLBACK_ATTEMPTS },
      OR: [{ callbackAttemptCount: 0 }, { callbackLastAttemptAt: { lte: throttleSince } }],
    },
    data: {
      callbackAttemptCount: { increment: 1 },
      callbackLastAttemptAt: new Date(),
    },
  });
  if (claimed.count === 0) {
    logger.debug("callback skip: delivered elsewhere, max auto attempts, or retry interval", {
      txId,
      maxAttempts: MAX_AUTO_CALLBACK_ATTEMPTS,
      minIntervalMs: CALLBACK_RETRY_MIN_INTERVAL_MS,
    });
    return;
  }

  try {
    logger.info("callback posting", { txId, url, chain: tx.chain, token: tx.tokenSymbol });
    const resp = await axios.post(url, body, {
      timeout: 15_000,
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Event": PAYMENT_WEBHOOK_EVENT,
      },
      validateStatus: (s) => s >= 200 && s < 300,
    });
    await prisma.transaction.updateMany({
      where: { id: tid, ...ACTIVE },
      data: { callbackDeliveredAt: new Date() },
    });
    logger.info("callback delivered", { txId, url });
    logPaymentSuccessCallback({
      merchantId: merchant.id,
      transactionId: tid,
      url,
      requestBody: body,
      ok: true,
      httpStatus: resp.status,
      responseSnippet: null,
      trigger: "auto",
    });
  } catch (e) {
    const detail = axiosErrDetail(e);
    logger.error("callback failed", {
      txId,
      url,
      err: String(e),
      ...detail,
    });
    logPaymentSuccessCallback({
      merchantId: merchant.id,
      transactionId: tid,
      url,
      requestBody: body,
      ok: false,
      httpStatus: detail.status ?? null,
      responseSnippet: detail.body ?? String(e).slice(0, 500),
      trigger: "auto",
    });
  }
}

export async function notifyPaymentUnderpaid(txId) {
  const tid = await resolveTransactionInternalId(txId);
  if (tid == null) {
    logger.warn("callback underpaid skip: tx not found", { txId });
    return;
  }
  const tx = await prisma.transaction.findFirst({
    where: { id: tid, ...ACTIVE },
    include: {
      wallet: { include: { merchant: true } },
      payerUser: { include: { merchant: true } },
    },
  });
  if (!tx) {
    logger.warn("callback underpaid skip: tx not found", { txId });
    return;
  }
  if (tx.callbackDeliveredAt) return;
  if (tx.status !== TX_STATUS_UNDERPAID) {
    logger.debug("callback underpaid skip: tx not underpaid yet", {
      txId,
      status: tx.status,
    });
    return;
  }
  const merchant = tx.payerUser?.merchant ?? tx.wallet.merchant;
  const url = merchant.callbackUrl;
  const expected =
    (await expectedAtomicForDepositSession(
      tx.walletId,
      tx.depositSessionKey,
    )) ?? "";
  const body = buildPaymentUnderpaidWebhookBody(tx, expected);
  if (!url) {
    logger.warn(
      "callback underpaid skip: merchant has no callback_url (set in portal)",
      { txId, payerUserId: tx.payerUserId, merchantId: merchant.id },
    );
    logPaymentUnderpaidCallback({
      merchantId: merchant.id,
      transactionId: tid,
      url: null,
      requestBody: body,
      ok: false,
      httpStatus: null,
      responseSnippet: "skipped: callback_url not configured",
      trigger: "skipped",
    });
    return;
  }

  const throttleSince = new Date(Date.now() - CALLBACK_RETRY_MIN_INTERVAL_MS);
  const now = new Date();
  const claimedCount = prismaClientKnowsTxStatusUnderpaid()
    ? (
        await prisma.transaction.updateMany({
          where: {
            id: tid,
            ...ACTIVE,
            status: TxStatus.underpaid,
            callbackDeliveredAt: null,
            callbackAttemptCount: { lt: MAX_AUTO_CALLBACK_ATTEMPTS },
            OR: [
              { callbackAttemptCount: 0 },
              { callbackLastAttemptAt: { lte: throttleSince } },
            ],
          },
          data: {
            callbackAttemptCount: { increment: 1 },
            callbackLastAttemptAt: now,
          },
        })
      ).count
    : await claimUnderpaidWebhookAttemptRaw(prisma, {
        transactionId: tid,
        now,
        throttleSince,
        maxAttempts: MAX_AUTO_CALLBACK_ATTEMPTS,
      });
  if (Number(claimedCount) === 0) {
    logger.debug(
      "callback underpaid skip: delivered elsewhere, max auto attempts, or retry interval",
      { txId },
    );
    return;
  }

  try {
    logger.info("callback underpaid posting", {
      txId,
      url,
      chain: tx.chain,
      token: tx.tokenSymbol,
    });
    const resp = await axios.post(url, body, {
      timeout: 15_000,
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Event": PAYMENT_WEBHOOK_EVENT,
      },
      validateStatus: (s) => s >= 200 && s < 300,
    });
    await prisma.transaction.updateMany({
      where: { id: tid, ...ACTIVE },
      data: { callbackDeliveredAt: new Date() },
    });
    logger.info("callback underpaid delivered", { txId, url });
    logPaymentUnderpaidCallback({
      merchantId: merchant.id,
      transactionId: tid,
      url,
      requestBody: body,
      ok: true,
      httpStatus: resp.status,
      responseSnippet: null,
      trigger: "auto",
    });
  } catch (e) {
    const detail = axiosErrDetail(e);
    logger.error("callback underpaid failed", {
      txId,
      url,
      err: String(e),
      ...detail,
    });
    logPaymentUnderpaidCallback({
      merchantId: merchant.id,
      transactionId: tid,
      url,
      requestBody: body,
      ok: false,
      httpStatus: detail.status ?? null,
      responseSnippet: detail.body ?? String(e).slice(0, 500),
      trigger: "auto",
    });
  }
}

/**
 * @param {import("@prisma/client").Transaction & {
 *   wallet: import("@prisma/client").Wallet & { merchant: import("@prisma/client").Merchant },
 *   payerUser: (import("@prisma/client").User & { merchant: import("@prisma/client").Merchant }) | null,
 * }} tx
 * @param {{ trigger: "merchant_redeliver" | "admin_redeliver", actorAdminId?: string | null, actorMerchantEmail?: string | null }} audit
 */
async function executeRedeliverPaymentSuccess(tx, audit) {
  const txId = tx.id;
  const merchant = tx.payerUser?.merchant ?? tx.wallet.merchant;
  const actorType =
    audit.trigger === "admin_redeliver" ? "admin" : "merchant_jwt";

  if (tx.status !== "success") {
    writeAuditLog({
      source: "callback",
      action: "callback.redeliver_blocked",
      merchantId: merchant.id,
      actorType,
      actorId: audit.actorAdminId ?? null,
      actorEmail: audit.actorMerchantEmail ?? null,
      summary: `Redeliver blocked: transaction not success (${txId})`,
      metadata: {
        transaction_id: txId,
        reason: "callback_requires_success",
        trigger: audit.trigger,
      },
    });
    return {
      ok: false,
      code: "callback_requires_success",
      message:
        "Resend is only available for successful transactions (payload status success).",
    };
  }
  const url = merchant.callbackUrl;
  if (!url) {
    writeAuditLog({
      source: "callback",
      action: "callback.redeliver_blocked",
      merchantId: merchant.id,
      actorType,
      actorId: audit.actorAdminId ?? null,
      actorEmail: audit.actorMerchantEmail ?? null,
      summary: `Redeliver blocked: no webhook URL (${txId})`,
      metadata: { transaction_id: txId, reason: "callback_url_not_set", trigger: audit.trigger },
    });
    return {
      ok: false,
      code: "callback_url_not_set",
      message: "Set a webhook URL under Gateway & webhooks first.",
    };
  }

  const body = buildPaymentSuccessWebhookBody(tx);

  try {
    logger.info("callback redeliver posting", {
      txId,
      url,
      chain: tx.chain,
      token: tx.tokenSymbol,
    });
    const resp = await axios.post(url, body, {
      timeout: 15_000,
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Event": PAYMENT_WEBHOOK_EVENT,
      },
      validateStatus: (s) => s >= 200 && s < 300,
    });
    if (!tx.callbackDeliveredAt) {
      await prisma.transaction.updateMany({
        where: { id: txId, ...ACTIVE },
        data: { callbackDeliveredAt: new Date() },
      });
    }
    logger.info("callback redelivered", { txId, url });
    logPaymentSuccessCallback({
      merchantId: merchant.id,
      transactionId: txId,
      url,
      requestBody: body,
      ok: true,
      httpStatus: resp.status,
      responseSnippet: null,
      trigger: audit.trigger,
      actorAdminId: audit.actorAdminId ?? null,
      actorMerchantEmail: audit.actorMerchantEmail ?? null,
    });
    return { ok: true };
  } catch (e) {
    const detail = axiosErrDetail(e);
    logger.error("callback redeliver failed", {
      txId,
      url,
      err: String(e),
      ...detail,
    });
    logPaymentSuccessCallback({
      merchantId: merchant.id,
      transactionId: txId,
      url,
      requestBody: body,
      ok: false,
      httpStatus: detail.status ?? null,
      responseSnippet: detail.body ?? String(e).slice(0, 500),
      trigger: audit.trigger,
      actorAdminId: audit.actorAdminId ?? null,
      actorMerchantEmail: audit.actorMerchantEmail ?? null,
    });
    return {
      ok: false,
      code: "callback_delivery_failed",
      message: "Your server did not return a 2xx response.",
      httpStatus: detail.status,
      bodySnippet: detail.body,
    };
  }
}

/**
 * POST the same payment webhook payload again (merchant portal). Does not create or update transaction rows except
 * optionally setting callbackDeliveredAt when it was still null after a successful delivery.
 *
 * @param {string} txId
 * @param {string} merchantId
 * @returns {Promise<{ ok: true } | { ok: false, code: string, message?: string, httpStatus?: number, bodySnippet?: string }>}
 */
/**
 * @param {string} txId
 * @param {string} merchantId
 * @param {{ actorEmail?: string | null }} [audit]
 */
export async function redeliverPaymentSuccessWebhook(txId, merchantId, audit = {}) {
  const txw = transactionWhereFromRouteParam(String(txId ?? ""));
  if (!txw) {
    return { ok: false, code: "transaction_not_found" };
  }
  const mid =
    typeof merchantId === "number" && Number.isInteger(merchantId) && merchantId >= 1
      ? merchantId
      : parseInt(String(merchantId ?? "").trim(), 10);
  if (!Number.isInteger(mid) || mid < 1) {
    return { ok: false, code: "transaction_not_found" };
  }
  const tx = await prisma.transaction.findFirst({
    where: {
      ...txw,
      ...ACTIVE,
      wallet: { is: { merchantId: mid, ...ACTIVE } },
    },
    include: {
      wallet: { include: { merchant: true } },
      payerUser: { include: { merchant: true } },
    },
  });
  if (!tx) {
    return { ok: false, code: "transaction_not_found" };
  }
  return executeRedeliverPaymentSuccess(tx, {
    trigger: "merchant_redeliver",
    actorMerchantEmail: audit.actorEmail ?? null,
  });
}

/**
 * Same as {@link redeliverPaymentSuccessWebhook} for any transaction (admin support).
 *
 * @param {string} txId
 */
/**
 * @param {string} txId
 * @param {{ actorAdminId?: string | null }} [audit]
 */
export async function redeliverPaymentSuccessWebhookAdmin(txId, audit = {}) {
  const txw = transactionWhereFromRouteParam(String(txId ?? ""));
  if (!txw) {
    return { ok: false, code: "transaction_not_found" };
  }
  const tx = await prisma.transaction.findFirst({
    where: { ...txw, ...ACTIVE },
    include: {
      wallet: { include: { merchant: true } },
      payerUser: { include: { merchant: true } },
    },
  });
  if (!tx) {
    return { ok: false, code: "transaction_not_found" };
  }
  return executeRedeliverPaymentSuccess(tx, {
    trigger: "admin_redeliver",
    actorAdminId: audit.actorAdminId ?? null,
  });
}
