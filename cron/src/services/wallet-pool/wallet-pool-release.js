import { ACTIVE } from "crypto-payment-gateway/src/lib/active-row.js";
import { prisma } from "crypto-payment-gateway/src/lib/prisma.js";
import { resolveWalletInternalId } from "crypto-payment-gateway/src/lib/entity-internal-id.js";

/**
 * Clear checkout hold/scan TTLs after a terminal deposit (success or underpaid) or stale checkout expiry.
 * Keeps `assigned_user_id` so the end-user keeps the same dedicated wallet on the rail (`deposit-address`).
 * Called from `transaction-upsert` (cron scanner or API sandbox) and checkout expiry cron, not on a timer.
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
      holdExpiresAt: null,
      scanExpiresAt: null,
      depositScanSingleTickRequested: false,
    },
  });
}

/**
 * Clear expired hold/scan timestamps without removing the user↔wallet link (dedicated wallets per user).
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
      holdExpiresAt: null,
      scanExpiresAt: null,
      depositScanSingleTickRequested: false,
    },
  });
  return r.count;
}
