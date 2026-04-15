import { ACTIVE } from "./active-row.js";
import { prisma } from "./prisma.js";

/**
 * Latest assignment event key for this wallet + payer (used when inserting a new transaction row).
 *
 * @param {number} walletInternalId
 * @param {number | null} payerUserId
 * @returns {Promise<string | null>}
 */
export async function depositSessionKeyForNewWalletTransaction(
  walletInternalId,
  payerUserId,
) {
  let uid = payerUserId;
  if (uid == null) {
    const w = await prisma.wallet.findFirst({
      where: { id: walletInternalId, ...ACTIVE },
      select: { assignedUserId: true },
    });
    uid = w?.assignedUserId ?? null;
  }
  if (uid == null) return null;
  const ev = await prisma.walletAssignmentEvent.findFirst({
    where: { walletId: walletInternalId, userId: uid, ...ACTIVE },
    orderBy: { id: "desc" },
    select: { depositSessionKey: true },
  });
  const k = ev?.depositSessionKey;
  return typeof k === "string" && k.length > 0 ? k : null;
}

/**
 * Latest assignment event merchant reference for this wallet + payer (new transaction rows).
 *
 * @param {number} walletInternalId
 * @param {number | null} payerUserId
 * @returns {Promise<string | null>}
 */
export async function referenceTransactionIdForNewWalletTransaction(
  walletInternalId,
  payerUserId,
) {
  let uid = payerUserId;
  if (uid == null) {
    const w = await prisma.wallet.findFirst({
      where: { id: walletInternalId, ...ACTIVE },
      select: { assignedUserId: true },
    });
    uid = w?.assignedUserId ?? null;
  }
  if (uid == null) return null;
  const ev = await prisma.walletAssignmentEvent.findFirst({
    where: { walletId: walletInternalId, userId: uid, ...ACTIVE },
    orderBy: { id: "desc" },
    select: { referenceTransactionId: true },
  });
  const k = ev?.referenceTransactionId;
  return typeof k === "string" && k.length > 0 ? k : null;
}
