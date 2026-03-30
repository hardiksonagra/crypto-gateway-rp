import { prisma } from "./prisma.js";
import { re } from "../config/runtime-env.js";

/**
 * Minutes for new wallet deposit monitoring. `0` = no TTL (`scan_expires_at` stays null; always scanned).
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
 * Prisma `where` fragment: live worker should include this wallet row.
 * Wallets with any transaction stay scanned (confirmations / callbacks).
 */
export function liveWorkerWalletScanFilter() {
  const now = new Date();
  return {
    OR: [
      { scanExpiresAt: null },
      { scanExpiresAt: { gt: now } },
      { transactions: { some: {} } },
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
  const at = nextScanExpiresAt();
  return prisma.wallet.update({
    where: { id: walletId },
    data: { scanExpiresAt: at },
    select: {
      id: true,
      scanExpiresAt: true,
      address: true,
      chain: true,
      currency: true,
      network: true,
    },
  });
}
