import { ACTIVE } from "crypto-payment-gateway/src/lib/active-row.js";
import { prisma } from "crypto-payment-gateway/src/lib/prisma.js";
import { resolveWalletInternalId } from "crypto-payment-gateway/src/lib/entity-internal-id.js";

/**
 * Return a wallet to the merchant pool after a successful on-chain deposit (`payer_user_id` stays on `transactions`).
 * Clears assign/hold/scan so the worker hot path skips this address until the next `assignPooledWalletForDeposit`.
 * Called from `transaction-upsert` (cron scanner or API sandbox), not on a timer.
 *
 * @param {string | number} walletId
 */
export async function releaseWalletAfterDepositSuccess(walletId) {
  const wid =
    typeof walletId === "number" && Number.isInteger(walletId)
      ? walletId
      : await resolveWalletInternalId(String(walletId ?? ""));
  if (wid == null) return;
  await prisma.wallet.updateMany({
    where: { id: wid, ...ACTIVE },
    data: {
      assignedUserId: null,
      holdExpiresAt: null,
      scanExpiresAt: null,
      depositScanSingleTickRequested: false,
    },
  });
}

/**
 * Clear stale pool assignments whose hold TTL passed (no successful deposit path cleared them yet).
 * Runs on a schedule in **crypto-gateway-cron-maintenance** only.
 *
 * @returns {Promise<number>} rows updated
 */
export async function releaseExpiredPoolHolds() {
  const r = await prisma.wallet.updateMany({
    where: {
      assignedUserId: { not: null },
      holdExpiresAt: { lt: new Date() },
      ...ACTIVE,
    },
    data: {
      assignedUserId: null,
      holdExpiresAt: null,
      scanExpiresAt: null,
      depositScanSingleTickRequested: false,
    },
  });
  return r.count;
}
