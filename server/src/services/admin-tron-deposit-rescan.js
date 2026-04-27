import { Chain } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { ACTIVE } from "../lib/active-row.js";
import { reactivateWalletDepositScan } from "../lib/wallet-scan.js";
import { transactionWhereFromRouteParam } from "../lib/entity-internal-id.js";
import { logger } from "../lib/logger.js";
import { hasActiveDepositScannerExplorerPool } from "../lib/deposit-scanner-explorer-key-pool.js";
import { scanTronChain } from "../../../cron/src/services/tracker/tron-tracker.js";

/**
 * Admin support: set one-shot deposit scan for the wallet and immediately run the same TronScan
 * TRC20 ingest path as the worker for that address (then clear the one-shot flag for this wallet).
 *
 * @param {string} transactionIdParam — digits-only internal `transactions.id` (admin list id).
 * @returns {Promise<
 *   | { ok: true; wallet_id: number; transaction: Record<string, unknown> }
 *   | { ok: false; code: string; message?: string }
 * >}
 */
export async function adminRescanTronDepositForTransaction(transactionIdParam) {
  const txw = transactionWhereFromRouteParam(String(transactionIdParam ?? ""));
  if (!txw) {
    return { ok: false, code: "invalid_transaction_id" };
  }

  const tx = await prisma.transaction.findFirst({
    where: { ...txw, ...ACTIVE },
    include: { wallet: true },
  });
  if (!tx) {
    return { ok: false, code: "transaction_not_found" };
  }

  if (tx.wallet.chain !== Chain.TRON) {
    return {
      ok: false,
      code: "chain_not_tron",
      message: "This action only runs the TRON (TronScan) deposit tracker.",
    };
  }

  if (
    String(tx.wallet.currency ?? "").toUpperCase() !== "USDT" ||
    String(tx.wallet.network ?? "").toUpperCase() !== "TRC20"
  ) {
    return {
      ok: false,
      code: "rail_not_usdt_trc20",
      message: "Wallet rail must be USDT·TRC20 for this rescan.",
    };
  }

  const tronPool = await hasActiveDepositScannerExplorerPool("trc20");
  if (!tronPool) {
    return {
      ok: false,
      code: "tronscan_not_configured",
      message:
        "TronScan is not configured: add at least one active key under Admin → Deposit explorer keys (TRC20).",
    };
  }

  await reactivateWalletDepositScan(tx.walletId, { asAdmin: true });

  try {
    await scanTronChain({
      wallets: [
        {
          id: tx.wallet.id,
          address: tx.wallet.address,
          currency: tx.wallet.currency,
          network: tx.wallet.network,
          merchantId: tx.wallet.merchantId,
        },
      ],
      adminDepositRescan: {
        walletId: tx.walletId,
        mergeTransactionId: tx.id,
      },
    });
  } catch (e) {
    logger.error("admin_tron_deposit_rescan_failed", {
      transactionId: tx.id,
      walletId: tx.walletId,
      err: String(e),
    });
    await prisma.wallet.updateMany({
      where: { id: tx.walletId, ...ACTIVE },
      data: { depositScanSingleTickRequested: false },
    });
    return {
      ok: false,
      code: "scan_failed",
      message: String(e),
    };
  }

  await prisma.wallet.updateMany({
    where: { id: tx.walletId, ...ACTIVE },
    data: { depositScanSingleTickRequested: false },
  });

  const updated = await prisma.transaction.findFirst({
    where: { ...txw, ...ACTIVE },
    select: {
      status: true,
      amount: true,
      txHash: true,
      fromAddress: true,
      toAddress: true,
      confirmations: true,
      updatedAt: true,
      callbackDeliveredAt: true,
      logIndex: true,
      blockNumber: true,
    },
  });

  return {
    ok: true,
    wallet_id: tx.walletId,
    transaction: updated
      ? {
          status: updated.status,
          amount: updated.amount,
          tx_hash: updated.txHash,
          from_address: updated.fromAddress,
          to_address: updated.toAddress,
          confirmations: updated.confirmations,
          updated_at: updated.updatedAt.toISOString(),
          callback_delivered_at: updated.callbackDeliveredAt?.toISOString() ?? null,
          log_index: updated.logIndex,
          block_number: updated.blockNumber?.toString() ?? null,
        }
      : {},
  };
}
