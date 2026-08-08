import { TxStatus } from "@prisma/client";
import { ACTIVE } from "./active-row.js";
import { prisma } from "./prisma.js";
import { prismaClientKnowsTxStatusCreated } from "./prisma-tx-status.js";

/**
 * Newest open `created` checkout placeholder for this wallet (+ optional payer).
 * Incoming on-chain credits bind LIFO (latest created first) — never rewrite already-successful txs.
 *
 * @param {number} walletInternalId
 * @param {number | null} payerUserId
 * @param {{ ignorePayerFilter?: boolean }} [opts] — when true, any open created on the wallet (newest first)
 * @returns {Promise<{ depositSessionKey: string | null, referenceTransactionId: string | null } | null>}
 */
export async function newestOpenCreatedCheckoutForWallet(
  walletInternalId,
  payerUserId,
  opts = {},
) {
  if (!prismaClientKnowsTxStatusCreated()) return null;
  const ignorePayer = opts.ignorePayerFilter === true;
  let uid = ignorePayer ? null : payerUserId;
  if (!ignorePayer && uid == null) {
    const w = await prisma.wallet.findFirst({
      where: { id: walletInternalId, ...ACTIVE },
      select: { assignedUserId: true },
    });
    uid = w?.assignedUserId ?? null;
  }
  /** @type {Record<string, unknown>} */
  const where = {
    walletId: walletInternalId,
    status: TxStatus.created,
    txHash: { startsWith: "gateway-created:" },
    ...ACTIVE,
  };
  if (!ignorePayer && uid != null) {
    where.payerUserId = uid;
  }
  const ph = await prisma.transaction.findFirst({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      depositSessionKey: true,
      referenceTransactionId: true,
    },
  });
  if (!ph) return null;
  return {
    depositSessionKey:
      typeof ph.depositSessionKey === "string" && ph.depositSessionKey.length > 0
        ? ph.depositSessionKey
        : null,
    referenceTransactionId:
      typeof ph.referenceTransactionId === "string" &&
      ph.referenceTransactionId.length > 0
        ? ph.referenceTransactionId
        : null,
  };
}

/**
 * Session key for a new on-chain row: newest open `created` checkout only.
 * If none, returns null (orphan success / pending — not tied to a prior success session).
 *
 * @param {number} walletInternalId
 * @param {number | null} payerUserId
 * @returns {Promise<string | null>}
 */
export async function depositSessionKeyForNewWalletTransaction(
  walletInternalId,
  payerUserId,
) {
  const ph = await newestOpenCreatedCheckoutForWallet(
    walletInternalId,
    payerUserId,
  );
  return ph?.depositSessionKey ?? null;
}

/**
 * Merchant/gateway reference for a new on-chain row: from newest open `created` checkout.
 * If none, returns null (caller generates a fresh reference for an orphan credit).
 *
 * @param {number} walletInternalId
 * @param {number | null} payerUserId
 * @returns {Promise<string | null>}
 */
export async function referenceTransactionIdForNewWalletTransaction(
  walletInternalId,
  payerUserId,
) {
  const ph = await newestOpenCreatedCheckoutForWallet(
    walletInternalId,
    payerUserId,
  );
  return ph?.referenceTransactionId ?? null;
}
