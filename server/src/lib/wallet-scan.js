import { TxStatus } from "@prisma/client";
import { ACTIVE } from "./active-row.js";
import { prisma } from "./prisma.js";
import { prismaClientKnowsTxStatusCreated } from "./prisma-tx-status.js";
import { re } from "../config/runtime-env.js";
import { resolveWalletInternalId } from "./entity-internal-id.js";

/**
 * Minutes for assign-time deposit window (`scan_expires_at`). Resolved via Admin → env → default 10.
 * @returns {number}
 */
export function walletScanTtlMinutes() {
  return re.walletScanTtlMinutes;
}

/**
 * Resolved scan TTL, or **10** when admin/env set `0` (null `scan_expires_at` in DB). Used for payment
 * API fallbacks only when DB `scan_expires_at` is null — uses `re.walletScanTtlMinutes` (always ≥ 1 after resolution).
 *
 * @returns {number}
 */
export function effectiveWalletScanTtlMinutes() {
  const m = re.walletScanTtlMinutes;
  return m > 0 ? m : 10;
}

/**
 * Resolved hold minutes, or **30** when `re` would be non-positive (should not happen after
 * {@link resolvedWalletAssignmentHoldMinutes}). Payment / hosted checkout consumers use this for
 * synthetic horizons when DB timestamps are null.
 *
 * @returns {number}
 */
export function effectiveWalletAssignmentHoldMinutes() {
  const m = re.walletAssignmentHoldMinutes;
  return m > 0 ? m : 30;
}

/** When checkout placeholder metadata is unavailable, payment page uses this many minutes from now. */
export const paymentPageCheckoutFallbackMinutes = 10;

/**
 * Always returns a future instant — assigned wallets must never get `scan_expires_at` null or deposits
 * can miss the live worker hot path and stay `pending`.
 *
 * @returns {Date}
 */
export function nextScanExpiresAt() {
  const m = re.walletScanTtlMinutes;
  const minutes =
    typeof m === "number" && Number.isFinite(m) && m > 0 ? m : 10;
  return new Date(Date.now() + minutes * 60 * 1000);
}

/**
 * Do not poll explorers for rows with **both** `hold_expires_at` and `scan_expires_at` SQL null **unless**
 * the wallet is dedicated to an end-user (`assigned_user_id` set) so deposits to that static address still
 * match between checkouts. Unassigned pool rows stay gated off when both TTLs are null.
 * Also: `deposit_scan_single_tick_requested` (explicit rescan).
 *
 * @returns {import("@prisma/client").Prisma.WalletWhereInput}
 */
export function depositScanBothTtlsNullGate() {
  return {
    OR: [
      {
        NOT: {
          AND: [{ holdExpiresAt: null }, { scanExpiresAt: null }],
        },
      },
      { depositScanSingleTickRequested: true },
      { assignedUserId: { not: null } },
    ],
  };
}

/**
 * Prisma `where` fragment: live worker hot path (each poll).
 * - **Gate:** see {@link depositScanBothTtlsNullGate} (idle unassigned pool vs dedicated addresses).
 * - **Dedicated user wallet:** `assigned_user_id` set — always poll (per-user deposit address persists after checkout).
 * - `deposit_scan_single_tick_requested` (merchant/admin rescan, one tick per chain).
 * - **Open checkout:** at least one active `transactions` row `status: created` with synthetic
 *   `gateway-created:*` hash — keeps scanning after hold/assign cleared so late USDT credits are
 *   not stuck until `DEPOSIT_FULL_SCAN_INTERVAL_HOURS` (requires Prisma client with `TxStatus.created`).
 */
export function liveWorkerWalletScanFilter() {
  /** @type {import("@prisma/client").Prisma.WalletWhereInput[]} */
  const or = [
    { assignedUserId: { not: null } },
    { depositScanSingleTickRequested: true },
  ];
  if (prismaClientKnowsTxStatusCreated()) {
    or.push({
      transactions: {
        some: {
          deletedAt: null,
          status: TxStatus.created,
          txHash: { startsWith: "gateway-created:" },
        },
      },
    });
  }
  return {
    AND: [depositScanBothTtlsNullGate(), { OR: or }],
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
