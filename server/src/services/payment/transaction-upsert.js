/**
 * **Sole write path for deposit rows** (`transactions` table): `upsertIncomingTransaction`.
 *
 * Callers: blockchain worker tick, deposit full-scan cron, sandbox simulate — all use this.
 * Merchant/admin “reset scan” only sets `deposit_scan_single_tick_requested`; the worker then runs
 * the same trackers below. No other code may `create`/`upsert` transactions.
 *
 * Duplicates: DB unique `tx_chain_log_unique` on `(chain, tx_hash, log_index)` plus upsert on that key
 * (TRON uses `log_index = -1` → one row per on-chain tx id on TRON).
 */
import { Chain, MerchantGatewayEnv, TxStatus } from "@prisma/client";
import { utils } from "tronweb";
import { prisma } from "../../lib/prisma.js";
import { logger } from "../../lib/logger.js";
import { confirmationsForChain } from "../../config/chains.js";
import { SCANNER_STATE_ROWS_BY_CHAIN } from "../../config/payment-rails.js";
import { notifyPaymentSuccess } from "../callback-service.js";
import { liveWorkerWalletScanFilter } from "../../lib/wallet-scan.js";
import {
  recordNewDepositInsert,
  workerRailMetricsEnabled,
} from "../tracker/deposit-rail-metrics.js";
import { releaseWalletAfterDepositSuccess } from "../wallet/wallet-service.js";
import {
  depositSessionKeyForNewWalletTransaction,
  referenceTransactionIdForNewWalletTransaction,
} from "../../lib/deposit-session-key.js";
import { generateGatewayReferenceTransactionId } from "../../lib/gateway-reference-transaction-id.js";
import { resolveWalletInternalId } from "../../lib/entity-internal-id.js";

/**
 * @param {object} input
 * @param {string} [input.currency] — wallet rail; with `network`, enables new-row tick metrics
 * @param {string} [input.network]
 * @param {string} [input.payerUserId] — when creating a row, prefer this over live `wallet.assigned_user_id`
 */
export async function upsertIncomingTransaction(input) {
  const threshold = confirmationsForChain(input.chain);
  const nextStatus =
    input.confirmations >= threshold ? TxStatus.success : TxStatus.pending;

  const walletInternalId = await resolveWalletInternalId(
    String(input.walletId ?? ""),
  );
  if (walletInternalId == null) {
    throw new Error("wallet_not_found_for_upsert");
  }

  const eventKey = {
    chain: input.chain,
    txHash: input.txHash,
    logIndex: input.logIndex,
  };

  const prior = await prisma.transaction.findUnique({
    where: { tx_chain_log_unique: eventKey },
    select: {
      id: true,
      walletId: true,
      toAddress: true,
      status: true,
      callbackDeliveredAt: true,
    },
  });

  if (
    prior &&
    !sameOnChainRecipient(input.chain, prior.toAddress, input.toAddress)
  ) {
    logger.error("transaction_recipient_mismatch_same_tx_log", {
      event: "transaction_recipient_mismatch_same_tx_log",
      ...eventKey,
      stored_to: prior.toAddress,
      incoming_to: input.toAddress,
    });
    return;
  }

  if (prior && prior.walletId !== walletInternalId) {
    logger.warn("transaction_dedupe_ignored_wallet", {
      event: "transaction_dedupe_ignored_wallet",
      tx_hash: input.txHash,
      chain: input.chain,
      token_symbol: input.tokenSymbol,
      log_index: input.logIndex,
      canonical_wallet_id: prior.walletId,
      ignored_wallet_id: walletInternalId,
    });
  }

  const hadRowBefore = Boolean(prior);

  let payerUserIdForCreate = input.payerUserId ?? null;
  if (!hadRowBefore && payerUserIdForCreate == null) {
    const w = await prisma.wallet.findUnique({
      where: { id: walletInternalId },
      select: { assignedUserId: true },
    });
    payerUserIdForCreate = w?.assignedUserId ?? null;
  }

  let depositSessionKeyForCreate = null;
  let referenceTransactionIdForCreate = null;
  if (!hadRowBefore) {
    depositSessionKeyForCreate = await depositSessionKeyForNewWalletTransaction(
      walletInternalId,
      payerUserIdForCreate,
    );
    referenceTransactionIdForCreate =
      await referenceTransactionIdForNewWalletTransaction(
        walletInternalId,
        payerUserIdForCreate,
      );
    if (!referenceTransactionIdForCreate) {
      referenceTransactionIdForCreate = generateGatewayReferenceTransactionId();
    }
  }

  const row = await prisma.transaction.upsert({
    where: { tx_chain_log_unique: eventKey },
    create: {
      walletId: walletInternalId,
      payerUserId: payerUserIdForCreate,
      depositSessionKey: depositSessionKeyForCreate ?? undefined,
      referenceTransactionId: referenceTransactionIdForCreate ?? undefined,
      txHash: input.txHash,
      fromAddress: input.fromAddress,
      toAddress: input.toAddress,
      amount: input.amount,
      tokenSymbol: input.tokenSymbol,
      tokenDecimals: input.tokenDecimals,
      chain: input.chain,
      status: nextStatus,
      confirmations: input.confirmations,
      blockNumber: input.blockNumber ?? undefined,
      logIndex: input.logIndex,
    },
    update: {
      confirmations: input.confirmations,
      blockNumber: input.blockNumber ?? undefined,
      status: nextStatus,
      updatedAt: new Date(),
    },
  });

  if (
    workerRailMetricsEnabled() &&
    input.currency != null &&
    input.network != null &&
    !hadRowBefore
  ) {
    recordNewDepositInsert(input.currency, input.network);
  }

  const becameSuccess =
    nextStatus === TxStatus.success &&
    (!prior || prior.status !== TxStatus.success);
  if (becameSuccess) {
    await releaseWalletAfterDepositSuccess(row.walletId);
  }

  if (nextStatus === TxStatus.success && !row.callbackDeliveredAt) {
    await notifyPaymentSuccess(row.id);
  }
}

/**
 * @param {import("@prisma/client").Chain} chain
 * @returns {Promise<Array<{ id: number, address: string, currency: string, network: string, merchantId: number }>>}
 */
export async function loadWalletsForChain(chain) {
  return prisma.wallet.findMany({
    where: {
      chain,
      environment: MerchantGatewayEnv.live,
      ...liveWorkerWalletScanFilter(),
    },
    select: {
      id: true,
      address: true,
      currency: true,
      network: true,
      merchantId: true,
    },
  });
}

/**
 * All live wallets on a chain (maintenance cron full pass — no hot-path TTL filter).
 * @param {import("@prisma/client").Chain} chain
 */
export async function loadAllLiveWalletsForChain(chain) {
  return prisma.wallet.findMany({
    where: { chain, environment: MerchantGatewayEnv.live },
    select: {
      id: true,
      address: true,
      currency: true,
      network: true,
      merchantId: true,
    },
  });
}

export function normalizeMatchAddress(chain, address) {
  if (chain === Chain.TRON) return address;
  return String(address ?? "").trim().toLowerCase();
}

/**
 * Same chain “to” for deposit matching (TRON base58 vs hex, EVM case-insensitive).
 * @param {import("@prisma/client").Chain} chain
 * @param {string} a
 * @param {string} b
 */
export function sameOnChainRecipient(chain, a, b) {
  const s = String(a ?? "");
  const t = String(b ?? "");
  if (chain === Chain.TRON) {
    try {
      return utils.address.toHex(s) === utils.address.toHex(t);
    } catch {
      return s === t;
    }
  }
  return normalizeMatchAddress(chain, s) === normalizeMatchAddress(chain, t);
}

/**
 * @param {import("@prisma/client").Chain} chain
 * @param {bigint} tip
 * @returns {Promise<bigint>}
 */
export async function getOrInitScannerBlock(chain, tip) {
  const spec = SCANNER_STATE_ROWS_BY_CHAIN[chain];
  if (!spec || spec.length === 0) {
    return tip > 12n ? tip - 12n : 0n;
  }

  let rows = await prisma.scannerState.findMany({ where: { chain } });
  if (rows.length === 0) {
    const warm = tip > 12n ? tip - 12n : 0n;
    await prisma.$transaction(
      spec.map(({ currency, network }) =>
        prisma.scannerState.create({
          data: { currency, network, chain, lastBlock: warm },
        }),
      ),
    );
    rows = await prisma.scannerState.findMany({ where: { chain } });
  }

  const minBlock = rows.reduce(
    (m, r) => (r.lastBlock < m ? r.lastBlock : m),
    rows[0].lastBlock,
  );

  if (minBlock === 0n && tip > 0n) {
    const warm = tip > 100n ? tip - 100n : 0n;
    await prisma.scannerState.updateMany({
      where: { chain },
      data: { lastBlock: warm },
    });
    return warm;
  }
  return minBlock;
}

/**
 * @param {import("@prisma/client").Chain} chain
 * @param {bigint} block
 */
export async function advanceScanner(chain, block) {
  await prisma.scannerState.updateMany({
    where: { chain },
    data: { lastBlock: block },
  });
}
