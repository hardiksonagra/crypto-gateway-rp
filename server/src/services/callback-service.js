import axios from "axios";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

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

  const u = tx.wallet.user;
  const body = {
    tx_hash: tx.txHash,
    amount: tx.amount,
    status: tx.status,
    chain: tx.chain,
    token_symbol: tx.tokenSymbol,
    wallet_address: tx.wallet.address,
    confirmations: tx.confirmations,
    external_user_id: u.externalUserId,
    merchant_id: merchant.id,
  };

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
