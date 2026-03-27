import axios from "axios";
import { formatAtomicAmountString } from "../lib/format-atomic-amount.js";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

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
  if (!url) {
    logger.warn("callback skip: merchant has no callback_url (set in portal)", {
      txId,
      userId: tx.wallet.userId,
      merchantId: merchant.id,
    });
    return;
  }

  const body = buildPaymentSuccessWebhookBody(tx);

  try {
    logger.info("callback posting", { txId, url, chain: tx.chain, token: tx.tokenSymbol });
    await axios.post(url, body, {
      timeout: 15_000,
      headers: { "Content-Type": "application/json", "X-Webhook-Event": "payment.success" },
      validateStatus: (s) => s >= 200 && s < 300,
    });
    await prisma.transaction.update({
      where: { id: txId },
      data: { callbackDeliveredAt: new Date() },
    });
    logger.info("callback delivered", { txId, url });
  } catch (e) {
    logger.error("callback failed", {
      txId,
      url,
      err: String(e),
      ...axiosErrDetail(e),
    });
  }
}

/**
 * @param {import("@prisma/client").Transaction & { wallet: import("@prisma/client").Wallet & { user: import("@prisma/client").User & { merchant: import("@prisma/client").AdminUser } } }} tx
 * @returns {Promise<{ ok: true } | { ok: false, code: string, message?: string, httpStatus?: number, bodySnippet?: string }>}
 */
async function executeRedeliverPaymentSuccess(tx) {
  const txId = tx.id;
  if (tx.status !== "success") {
    return {
      ok: false,
      code: "callback_requires_success",
      message: "Webhooks are only sent for successful transactions.",
    };
  }
  const merchant = tx.wallet.user.merchant;
  const url = merchant.callbackUrl;
  if (!url) {
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
    await axios.post(url, body, {
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
    return { ok: true };
  } catch (e) {
    const detail = axiosErrDetail(e);
    logger.error("callback redeliver failed", {
      txId,
      url,
      err: String(e),
      ...detail,
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
export async function redeliverPaymentSuccessWebhook(txId, merchantId) {
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
  return executeRedeliverPaymentSuccess(tx);
}

/**
 * Same as {@link redeliverPaymentSuccessWebhook} for any transaction (admin support).
 *
 * @param {string} txId
 */
export async function redeliverPaymentSuccessWebhookAdmin(txId) {
  const tx = await prisma.transaction.findUnique({
    where: { id: txId },
    include: { wallet: { include: { user: { include: { merchant: true } } } } },
  });
  if (!tx) {
    return { ok: false, code: "transaction_not_found" };
  }
  return executeRedeliverPaymentSuccess(tx);
}
