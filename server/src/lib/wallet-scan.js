import { prisma } from "./prisma.js";
import { re } from "../config/runtime-env.js";

/**
 * Minutes for assign-time deposit window (`scan_expires_at`). `0` = null TTL (hot path only via rescan flag or full-scan cron).
 * @returns {number}
 */
export function walletScanTtlMinutes() {
  return re.walletScanTtlMinutes;
}

/**
 * @returns {Date | null}
 */
export function nextScanExpiresAt() {
  const m = re.walletScanTtlMinutes;
  if (m <= 0) return null;
  return new Date(Date.now() + m * 60 * 1000);
}

/**
 * Prisma `where` fragment: live worker hot path (each poll). Does **not** look at `transactions`.
 * - `scan_expires_at` still in the future (assign / session window).
 * - `deposit_scan_single_tick_requested` (merchant/admin rescan, one tick per chain).
 * After TTL: only `DEPOSIT_FULL_SCAN_INTERVAL_HOURS` maintenance pass + optional rescan.
 */
export function liveWorkerWalletScanFilter() {
  const now = new Date();
  return {
    OR: [
      { scanExpiresAt: { gt: now } },
      { depositScanSingleTickRequested: true },
    ],
  };
}

/**
 * @param {string} walletId
 * @param {{ merchantId?: string | null, asAdmin?: boolean }} opts
 */
export async function reactivateWalletDepositScan(walletId, opts = {}) {
  const { merchantId = null, asAdmin = false } = opts;
  const w = await prisma.wallet.findUnique({
    where: { id: walletId },
    select: { merchantId: true },
  });
  if (!w) {
    const e = new Error("WALLET_NOT_FOUND");
    /** @type {any} */ (e).code = "WALLET_NOT_FOUND";
    throw e;
  }
  if (!asAdmin && merchantId != null && w.merchantId !== merchantId) {
    const e = new Error("FORBIDDEN");
    /** @type {any} */ (e).code = "FORBIDDEN";
    throw e;
  }
  return prisma.wallet.update({
    where: { id: walletId },
    data: { depositScanSingleTickRequested: true },
    select: {
      id: true,
      scanExpiresAt: true,
      depositScanSingleTickRequested: true,
      address: true,
      chain: true,
      currency: true,
      network: true,
    },
  });
}
