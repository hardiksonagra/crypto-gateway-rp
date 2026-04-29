/**
 * **Sole write path for deposit rows** (`transactions` table): `upsertIncomingTransaction`.
 *
 * Callers: blockchain worker tick, deposit full-scan cron, sandbox simulate — all use this.
 * Merchant/admin “reset scan” only sets `deposit_scan_single_tick_requested`; the worker then runs
 * the same trackers below. No other code may `create`/`upsert` transactions.
 *
 * Duplicates: DB unique `tx_chain_log_unique` on `(chain, tx_hash, log_index)` plus upsert on that key
 * (TRON uses `log_index = -1` → one row per on-chain tx id on TRON).
 *
 * First on-chain credit for a checkout **updates** the existing `status: created` placeholder row
 * (same `id` as after `deposit-address`) when session + `gateway-created:*` hash match; further
 * transfers for the same session use new rows as before. Legacy raw underpaid upsert still inserts.
 * Underpaid closes the checkout: wallet returns to pool (no further session top-ups promoted to success).
 * Once a row is `underpaid`, later `upsertIncomingTransaction` calls for the same on-chain key no-op
 * (no field updates), like a frozen terminal row.
 */
import { Chain, MerchantGatewayEnv, TxStatus } from "@prisma/client";
import {
  prismaClientKnowsTxStatusCreated,
  prismaClientKnowsTxStatusUnderpaid,
  TX_STATUS_UNDERPAID,
} from "../../lib/prisma-tx-status.js";
import { upsertTransactionRowUnderpaidRaw } from "../../lib/underpaid-prisma-raw.js";
import { utils } from "tronweb";
import { prisma } from "../../lib/prisma.js";
import { ACTIVE } from "../../lib/active-row.js";
import { logger } from "../../lib/logger.js";
import { confirmationsForChain } from "../../config/chains.js";
import { SCANNER_STATE_ROWS_BY_CHAIN } from "../../config/payment-rails.js";
import {
  notifyPaymentSuccess,
  notifyPaymentUnderpaid,
} from "../callback-service.js";
import {
  depositScanBothTtlsNullGate,
  liveWorkerWalletScanFilter,
} from "../../lib/wallet-scan.js";
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
import {
  coerceTransactionPrimaryKey,
  resolveWalletInternalId,
} from "../../lib/entity-internal-id.js";
import {
  expectedAtomicForDepositSession,
  sumInboundAtomicForSessionExcluding,
} from "../../lib/expected-deposit-amount.js";
import { UNDERPAY_TOLERANCE_ATOMIC } from "../../lib/gateway-expected-amount.js";

/**
 * @param {object} input
 * @param {string} [input.currency] — wallet rail; with `network`, enables new-row tick metrics
 * @param {string} [input.network]
 * @param {string} [input.payerUserId] — when creating a row, prefer this over live `wallet.assigned_user_id`
 * @param {string | number} [input.adminMergeTargetTransactionId] — optional internal `transactions.id` to merge
 *   into when it is still the `gateway-created:*` checkout placeholder (admin TRON rescan); avoids a second row.
 */
export async function upsertIncomingTransaction(input) {
  const threshold = confirmationsForChain(input.chain);

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
      depositSessionKey: true,
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

  const hadRowBefore = Boolean(prior);
  if (
    prior &&
    String(prior.status ?? "")
      .trim()
      .toLowerCase() === TX_STATUS_UNDERPAID
  ) {
    return;
  }

  let payerUserIdForCreate = input.payerUserId ?? null;
  if (!hadRowBefore && payerUserIdForCreate == null) {
    const w = await prisma.wallet.findFirst({
      where: { id: walletInternalId, ...ACTIVE },
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
    const missingKeysFromAssignment =
      depositSessionKeyForCreate == null ||
      referenceTransactionIdForCreate == null;
    // Assignment helpers key off `wallet.assigned_user_id` + latest `wallet_assignment_events`.
    // After hold expiry / pool release (or worker lag), that user link is null but the checkout
    // placeholder row still holds `deposit_session_key` + `transaction_id` — recover from it so
    // on-chain rows keep the same reference as `deposit-address` (avoids gateway GET 404).
    if (prismaClientKnowsTxStatusCreated() && missingKeysFromAssignment) {
      const fb = await prisma.transaction.findFirst({
        where: {
          walletId: walletInternalId,
          chain: input.chain,
          status: TxStatus.created,
          txHash: { startsWith: "gateway-created:" },
          ...ACTIVE,
        },
        orderBy: { id: "desc" },
        select: {
          depositSessionKey: true,
          referenceTransactionId: true,
        },
      });
      if (fb?.depositSessionKey) {
        depositSessionKeyForCreate =
          depositSessionKeyForCreate ?? fb.depositSessionKey;
      }
      if (fb?.referenceTransactionId) {
        referenceTransactionIdForCreate =
          referenceTransactionIdForCreate ?? fb.referenceTransactionId;
      }
      if (fb) {
        logger.info("checkout_session_keys_recovered_from_placeholder", {
          wallet_id: walletInternalId,
          chain: input.chain,
        });
      }
    }
    if (!referenceTransactionIdForCreate) {
      referenceTransactionIdForCreate = generateGatewayReferenceTransactionId();
    }
  }

  let nextStatus =
    input.confirmations >= threshold ? TxStatus.success : TxStatus.pending;

  if (prior?.status === TxStatus.success) {
    nextStatus = TxStatus.success;
  } else if (nextStatus === TxStatus.success) {
    const sessionKeyForExpected = hadRowBefore
      ? prior.depositSessionKey
      : depositSessionKeyForCreate;
    const expected = sessionKeyForExpected
      ? await expectedAtomicForDepositSession(
          walletInternalId,
          sessionKeyForExpected,
        )
      : null;
    if (expected != null) {
      try {
        const exp = BigInt(expected);
        const incoming = BigInt(String(input.amount ?? "0").trim());
        const othersSum = await sumInboundAtomicForSessionExcluding(
          walletInternalId,
          sessionKeyForExpected,
          eventKey,
        );
        const totalRecv = othersSum + incoming;
        if (totalRecv + UNDERPAY_TOLERANCE_ATOMIC < exp) {
          nextStatus = TX_STATUS_UNDERPAID;
        }
      } catch {
        logger.warn("underpaid_amount_compare_skipped", {
          wallet_id: walletInternalId,
          tx_hash: input.txHash,
          chain: input.chain,
        });
      }
    }
  }

  const useRawUnderpaidUpsert =
    nextStatus === TX_STATUS_UNDERPAID && !prismaClientKnowsTxStatusUnderpaid();

  /** First on-chain event updated the checkout placeholder in place (stable internal id). */
  let mergedIntoPlaceholder = false;
  /** @type {import("@prisma/client").Transaction | Awaited<ReturnType<typeof upsertTransactionRowUnderpaidRaw>> | undefined} */
  let row;

  const adminMergeTid = coerceTransactionPrimaryKey(
    input.adminMergeTargetTransactionId,
  );
  if (
    !hadRowBefore &&
    !useRawUnderpaidUpsert &&
    adminMergeTid != null
  ) {
    const target = await prisma.transaction.findFirst({
      where: {
        id: adminMergeTid,
        walletId: walletInternalId,
        chain: input.chain,
        txHash: { startsWith: "gateway-created:" },
        ...ACTIVE,
      },
      select: { id: true, status: true, amount: true },
    });
    const amt0 = String(target?.amount ?? "").trim() === "0";
    const st = target?.status;
    const mergeablePlaceholder =
      Boolean(target) &&
      amt0 &&
      (st === TxStatus.created ||
        st === "created" ||
        (st === TxStatus.pending || st === "pending"));
    if (target && mergeablePlaceholder) {
      row = await prisma.transaction.update({
        where: { id: target.id },
        data: {
          txHash: input.txHash,
          fromAddress: input.fromAddress,
          toAddress: input.toAddress,
          amount: input.amount,
          tokenSymbol: input.tokenSymbol,
          tokenDecimals: input.tokenDecimals,
          confirmations: input.confirmations,
          blockNumber: input.blockNumber ?? undefined,
          logIndex: input.logIndex,
          status: nextStatus,
          ...(payerUserIdForCreate != null
            ? { payerUserId: payerUserIdForCreate }
            : {}),
          updatedAt: new Date(),
        },
      });
      mergedIntoPlaceholder = true;
      logger.info("checkout_placeholder_merged_on_chain", {
        wallet_id: walletInternalId,
        transaction_id: row.id,
        admin_merge_target: true,
      });
    }
  }

  if (
    !row &&
    !hadRowBefore &&
    !useRawUnderpaidUpsert &&
    prismaClientKnowsTxStatusCreated()
  ) {
    const placeholderWhere = {
      walletId: walletInternalId,
      chain: input.chain,
      status: TxStatus.created,
      txHash: { startsWith: "gateway-created:" },
      ...ACTIVE,
    };
    let ph =
      depositSessionKeyForCreate != null
        ? await prisma.transaction.findFirst({
            where: {
              ...placeholderWhere,
              depositSessionKey: depositSessionKeyForCreate,
            },
            orderBy: { id: "desc" },
            select: { id: true },
          })
        : null;
    if (!ph) {
      ph = await prisma.transaction.findFirst({
        where: placeholderWhere,
        orderBy: { id: "desc" },
        select: { id: true },
      });
    }
    if (ph) {
      row = await prisma.transaction.update({
        where: { id: ph.id },
        data: {
          txHash: input.txHash,
          fromAddress: input.fromAddress,
          toAddress: input.toAddress,
          amount: input.amount,
          tokenSymbol: input.tokenSymbol,
          tokenDecimals: input.tokenDecimals,
          confirmations: input.confirmations,
          blockNumber: input.blockNumber ?? undefined,
          logIndex: input.logIndex,
          status: nextStatus,
          ...(payerUserIdForCreate != null
            ? { payerUserId: payerUserIdForCreate }
            : {}),
          updatedAt: new Date(),
        },
      });
      mergedIntoPlaceholder = true;
      logger.info("checkout_placeholder_merged_on_chain", {
        wallet_id: walletInternalId,
        transaction_id: row.id,
      });
    }
  }

  if (!row) {
    row = useRawUnderpaidUpsert
      ? await upsertTransactionRowUnderpaidRaw(prisma, {
          walletInternalId,
          payerUserIdForCreate,
          depositSessionKeyForCreate,
          referenceTransactionIdForCreate,
          input,
        })
      : await prisma.transaction.upsert({
          where: { tx_chain_log_unique: eventKey },
          create: {
            walletId: walletInternalId,
            payerUserId: payerUserIdForCreate,
            depositSessionKey: depositSessionKeyForCreate ?? undefined,
            referenceTransactionId:
              referenceTransactionIdForCreate ?? undefined,
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
  }

  // After merge, no `created` row remains for this session. If we inserted a new on-chain row
  // instead, soft-remove any leftover checkout placeholder(s) for the same session.
  //
  // IMPORTANT: only run when Prisma exposes `TxStatus.created`. If `TxStatus.created` is
  // `undefined` (stale `@prisma/client`), Prisma **drops** `status` from the `where` clause and
  // would soft-delete **every** row for this wallet + session (including success) — run
  // `npx prisma generate` in `server/` after migrations that add `created` to `TxStatus`.
  if (row.depositSessionKey && prismaClientKnowsTxStatusCreated()) {
    const ph = await prisma.transaction.updateMany({
      where: {
        walletId: row.walletId,
        depositSessionKey: row.depositSessionKey,
        status: TxStatus.created,
        ...ACTIVE,
      },
      data: { deletedAt: new Date(), updatedAt: new Date() },
    });
    if (ph.count > 0) {
      logger.info("checkout_placeholder_soft_removed", {
        wallet_id: row.walletId,
        count: ph.count,
      });
    }
  }

  if (
    workerRailMetricsEnabled() &&
    input.currency != null &&
    input.network != null &&
    !hadRowBefore &&
    !mergedIntoPlaceholder
  ) {
    recordNewDepositInsert(input.currency, input.network);
  }

  const becameSuccess =
    nextStatus === TxStatus.success &&
    (!prior || prior.status !== TxStatus.success);
  const becameUnderpaid =
    nextStatus === TX_STATUS_UNDERPAID &&
    (!prior || prior.status !== TX_STATUS_UNDERPAID);

  if (becameSuccess || becameUnderpaid) {
    await releaseWalletAfterDepositSuccess(row.walletId);
  }

  const notifyPk = coerceTransactionPrimaryKey(row.id);
  if (notifyPk == null) {
    logger.error("upsert_invalid_transaction_row_id", {
      wallet_id: walletInternalId,
      tx_hash: input.txHash,
      chain: input.chain,
      raw_id: row.id,
    });
  } else if (becameUnderpaid && !row.callbackDeliveredAt) {
    await notifyPaymentUnderpaid(notifyPk);
  } else if (nextStatus === TxStatus.success && !row.callbackDeliveredAt) {
    await notifyPaymentSuccess(notifyPk);
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
      ...ACTIVE,
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
 * All live wallets on a chain for maintenance full pass. Uses the same **both TTLs null** gate as the
 * worker ({@link depositScanBothTtlsNullGate}) so idle pool rows are not scanned; does not apply the
 * full hot-path OR (assign / hold / single-tick / checkout) — that remains {@link loadWalletsForChain}.
 * @param {import("@prisma/client").Chain} chain
 */
export async function loadAllLiveWalletsForChain(chain) {
  return prisma.wallet.findMany({
    where: {
      chain,
      environment: MerchantGatewayEnv.live,
      ...ACTIVE,
      AND: [depositScanBothTtlsNullGate()],
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

export function normalizeMatchAddress(chain, address) {
  if (chain === Chain.TRON) return address;
  return String(address ?? "")
    .trim()
    .toLowerCase();
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

  let rows = await prisma.scannerState.findMany({
    where: { chain, ...ACTIVE },
  });
  if (rows.length === 0) {
    const warm = tip > 12n ? tip - 12n : 0n;
    await prisma.$transaction(
      spec.map(({ currency, network }) =>
        prisma.scannerState.create({
          data: { currency, network, chain, lastBlock: warm },
        }),
      ),
    );
    rows = await prisma.scannerState.findMany({ where: { chain, ...ACTIVE } });
  }

  const minBlock = rows.reduce(
    (m, r) => (r.lastBlock < m ? r.lastBlock : m),
    rows[0].lastBlock,
  );

  if (minBlock === 0n && tip > 0n) {
    const warm = tip > 100n ? tip - 100n : 0n;
    await prisma.scannerState.updateMany({
      where: { chain, ...ACTIVE },
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
    where: { chain, ...ACTIVE },
    data: { lastBlock: block },
  });
}
