import { ACTIVE } from "./active-row.js";
import { prisma } from "./prisma.js";
import { re } from "../config/runtime-env.js";
import { resolveWalletInternalId } from "./entity-internal-id.js";

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
 * - `assigned_user_id` set and `scan_expires_at` still in the future — checkout scan window (`WALLET_SCAN_TTL_MINUTES`).
 *   (Unassigned pool rows must not be polled on TTL alone; cleared on payment success / expired hold.)
 * - Assigned wallet whose **pooled hold** has not expired — keep scanning until `WALLET_ASSIGNMENT_HOLD_MINUTES`
 *   ends even after scan TTL (e.g. UI 10m, hold 30m).
 * - `deposit_scan_single_tick_requested` (merchant/admin rescan, one tick per chain).
 * If none match: `DEPOSIT_FULL_SCAN_INTERVAL_HOURS` full-scan pass + optional rescan.
 */
export function liveWorkerWalletScanFilter() {
  const now = new Date();
  return {
    OR: [
      {
        AND: [
          { assignedUserId: { not: null } },
          { scanExpiresAt: { gt: now } },
        ],
      },
      { depositScanSingleTickRequested: true },
      {
        AND: [
          { assignedUserId: { not: null } },
          { holdExpiresAt: { gt: now } },
        ],
      },
    ],
  };
}

/**
 * @param {string | number} walletIdRaw — wallet integer `id` (digits only as string).
 * @param {{ merchantId?: number | null, asAdmin?: boolean }} opts
 */
export async function reactivateWalletDepositScan(walletIdRaw, opts = {}) {
  const { merchantId = null, asAdmin = false } = opts;
  const walletId =
    typeof walletIdRaw === "number" && Number.isInteger(walletIdRaw)
      ? walletIdRaw
      : await resolveWalletInternalId(String(walletIdRaw ?? ""));
  if (walletId == null) {
    const e = new Error("WALLET_NOT_FOUND");
    /** @type {any} */ (e).code = "WALLET_NOT_FOUND";
    throw e;
  }
  const w = await prisma.wallet.findFirst({
    where: { id: walletId, ...ACTIVE },
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
