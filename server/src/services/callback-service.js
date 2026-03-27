import axios from "axios";
import { formatAtomicAmountString } from "../lib/format-atomic-amount.js";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { logPaymentSuccessCallback, writeAuditLog } from "./audit-log.js";

/**
 * @param {import("@prisma/client").Transaction & { wallet: import("@prisma/client").Wallet & { user: import("@prisma/client").User & { merchant: import("@prisma/client").AdminUser } } }} tx
 * @returns {Record<string, unknown>}
 */
export function buildPaymentSuccessWebhookBody(tx) {
  const u = tx.wallet.user;
  const merchant = u.merchant;
  return {
    transaction_id: tx.id,
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
    external_user_id: u.externalUserId,
    merchant_id: merchant.id,
    gateway_environment: u.environment,
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
  const tx = await prisma.transaction.findUnique({
    where: { id: txId },
    include: { wallet: { include: { user: { include: { merchant: true } } } } },
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
  const merchant = tx.wallet.user.merchant;
  const url = merchant.callbackUrl;
  const body = buildPaymentSuccessWebhookBody(tx);
  if (!url) {
    logger.warn("callback skip: merchant has no callback_url (set in portal)", {
      txId,
      userId: tx.wallet.userId,
      merchantId: merchant.id,
    });
    logPaymentSuccessCallback({
      merchantId: merchant.id,
      transactionId: txId,
      url: null,
      requestBody: body,
      ok: false,
      httpStatus: null,
      responseSnippet: "skipped: callback_url not configured",
      trigger: "skipped",
    });
    return;
  }

  try {
    logger.info("callback posting", { txId, url, chain: tx.chain, token: tx.tokenSymbol });
    const resp = await axios.post(url, body, {
      timeout: 15_000,
      headers: { "Content-Type": "application/json", "X-Webhook-Event": "payment.success" },
      validateStatus: (s) => s >= 200 && s < 300,
    });
    await prisma.transaction.update({
      where: { id: txId },
      data: { callbackDeliveredAt: new Date() },
    });
    logger.info("callback delivered", { txId, url });
    logPaymentSuccessCallback({
      merchantId: merchant.id,
      transactionId: txId,
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
      transactionId: txId,
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
 * @param {import("@prisma/client").Transaction & { wallet: import("@prisma/client").Wallet & { user: import("@prisma/client").User & { merchant: import("@prisma/client").AdminUser } } }} tx
 * @returns {Promise<{ ok: true } | { ok: false, code: string, message?: string, httpStatus?: number, bodySnippet?: string }>}
 */
/**
 * @param {import("@prisma/client").Transaction & { wallet: import("@prisma/client").Wallet & { user: import("@prisma/client").User & { merchant: import("@prisma/client").AdminUser } } }} tx
 * @param {{ trigger: "merchant_redeliver" | "admin_redeliver", actorAdminId?: string | null, actorMerchantEmail?: string | null }} audit
 */
async function executeRedeliverPaymentSuccess(tx, audit) {
  const txId = tx.id;
  const merchant = tx.wallet.user.merchant;
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
      message: "Webhooks are only sent for successful transactions.",
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
      headers: { "Content-Type": "application/json", "X-Webhook-Event": "payment.success" },
      validateStatus: (s) => s >= 200 && s < 300,
    });
    if (!tx.callbackDeliveredAt) {
      await prisma.transaction.update({
        where: { id: txId },
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
 * POST the same payment.success payload again (merchant portal). Does not create or update transaction rows except
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
  const tx = await prisma.transaction.findFirst({
    where: {
      id: txId,
      wallet: { user: { merchantId } },
    },
    include: { wallet: { include: { user: { include: { merchant: true } } } } },
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
  const tx = await prisma.transaction.findUnique({
    where: { id: txId },
    include: { wallet: { include: { user: { include: { merchant: true } } } } },
  });
  if (!tx) {
    return { ok: false, code: "transaction_not_found" };
  }
  return executeRedeliverPaymentSuccess(tx, {
    trigger: "admin_redeliver",
    actorAdminId: audit.actorAdminId ?? null,
  });
}
