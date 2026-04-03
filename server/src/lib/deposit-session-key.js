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
    const w = await prisma.wallet.findUnique({
      where: { id: walletInternalId },
      select: { assignedUserId: true },
    });
    uid = w?.assignedUserId ?? null;
  }
  if (uid == null) return null;
  const ev = await prisma.walletAssignmentEvent.findFirst({
    where: { walletId: walletInternalId, userId: uid },
    orderBy: { id: "desc" },
    select: { depositSessionKey: true },
  });
  const k = ev?.depositSessionKey;
  return typeof k === "string" && k.length > 0 ? k : null;
}
