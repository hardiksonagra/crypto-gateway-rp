import { prisma } from "crypto-payment-gateway/src/lib/prisma.js";

/**
 * Return a wallet to the merchant pool after a successful on-chain deposit (`payer_user_id` stays on `transactions`).
 * Called from `transaction-upsert` (cron scanner or API sandbox), not on a timer.
 *
 * @param {string} walletId
 */
export async function releaseWalletAfterDepositSuccess(walletId) {
  await prisma.wallet.updateMany({
    where: { id: walletId },
    data: {
      assignedUserId: null,
      holdExpiresAt: null,
    },
  });
}

/**
 * Clear stale pool assignments whose hold TTL passed (no successful deposit path cleared them yet).
 * Runs on a schedule in the **crypto-gateway-cron** process only.
 *
 * @returns {Promise<number>} rows updated
 */
export async function releaseExpiredPoolHolds() {
  const r = await prisma.wallet.updateMany({
    where: {
      assignedUserId: { not: null },
      holdExpiresAt: { lt: new Date() },
    },
    data: {
      assignedUserId: null,
      holdExpiresAt: null,
    },
  });
  return r.count;
}
