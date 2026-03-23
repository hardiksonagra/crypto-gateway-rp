import axios from "axios";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

function axiosErrDetail(e: unknown): Record<string, string | number | undefined> {
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

/**
 * Outbound payment webhooks.
 * Architecture: fire-and-forget with bounded timeout; mark delivery to avoid duplicates.
 */
export async function notifyPaymentSuccess(txId: string): Promise<void> {
  const tx = await prisma.transaction.findUnique({
    where: { id: txId },
    include: { wallet: { include: { user: true } } },
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
  const url = tx.wallet.user.callbackUrl;
  if (!url) {
    logger.warn("callback skip: user has no callback_url (set `callback_url` on POST /api/deposit-address)", {
      txId,
      userId: tx.wallet.userId,
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
    ...(u.merchantRef != null ? { merchant_ref: u.merchantRef } : {}),
    ...(u.externalUserId != null ? { external_user_id: u.externalUserId } : {}),
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
