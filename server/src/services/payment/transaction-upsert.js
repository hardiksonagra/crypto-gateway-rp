import { Chain, MerchantGatewayEnv, TxStatus } from "@prisma/client";
import { Address } from "@ton/core";
import { prisma } from "../../lib/prisma.js";
import { confirmationsForChain } from "../../config/chains.js";
import { SCANNER_STATE_ROWS_BY_CHAIN } from "../../config/payment-rails.js";
import { notifyPaymentSuccess } from "../callback-service.js";
import { liveWorkerWalletScanFilter } from "../../lib/wallet-scan.js";
import {
  recordNewDepositInsert,
  workerRailMetricsEnabled,
} from "../tracker/deposit-rail-metrics.js";
import { releaseWalletAfterDepositSuccess } from "../wallet/wallet-service.js";
import { depositSessionKeyForNewWalletTransaction } from "../../lib/deposit-session-key.js";
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

  const dedupe = {
    txHash: input.txHash,
    chain: input.chain,
    walletId: walletInternalId,
    tokenSymbol: input.tokenSymbol,
    logIndex: input.logIndex,
  };

  const prior = await prisma.transaction.findUnique({
    where: { tx_dedupe: dedupe },
    select: { id: true, status: true, callbackDeliveredAt: true },
  });
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
  if (!hadRowBefore) {
    depositSessionKeyForCreate = await depositSessionKeyForNewWalletTransaction(
      walletInternalId,
      payerUserIdForCreate,
    );
  }

  const row = await prisma.transaction.upsert({
    where: {
      tx_dedupe: dedupe,
    },
    create: {
      walletId: walletInternalId,
      payerUserId: payerUserIdForCreate,
      depositSessionKey: depositSessionKeyForCreate ?? undefined,
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
    await releaseWalletAfterDepositSuccess(walletInternalId);
  }

  if (nextStatus === TxStatus.success && !row.callbackDeliveredAt) {
    await notifyPaymentSuccess(row.id);
  }
}

/**
 * @param {import("@prisma/client").Chain} chain
 * @returns {Promise<Array<{ id: string, address: string, currency: string, network: string }>>}
 */
export async function loadWalletsForChain(chain) {
  return prisma.wallet.findMany({
    where: {
      chain,
      environment: MerchantGatewayEnv.live,
      ...liveWorkerWalletScanFilter(),
    },
    select: { id: true, address: true, currency: true, network: true },
  });
}

/**
 * All live wallets on a chain (maintenance cron full pass — no hot-path TTL filter).
 * @param {import("@prisma/client").Chain} chain
 */
export async function loadAllLiveWalletsForChain(chain) {
  return prisma.wallet.findMany({
    where: { chain, environment: MerchantGatewayEnv.live },
    select: { id: true, address: true, currency: true, network: true },
  });
}

export function normalizeMatchAddress(chain, address) {
  if (chain === Chain.TRON) return address;
  if (chain === Chain.SOLANA) return address.trim();
  if (chain === Chain.BTC) return address;
  if (chain === Chain.TON) {
    try {
      return Address.parse(address.trim()).toRawString();
    } catch {
      return address.trim();
    }
  }
  return address.toLowerCase();
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
