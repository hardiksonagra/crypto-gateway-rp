import { TxStatus } from "@prisma/client";
import { prisma } from "./prisma.js";
import { ACTIVE } from "./active-row.js";
import { prismaClientKnowsTxStatusUnderpaid } from "./prisma-tx-status.js";
import { selectSessionInboundAmountRowsRaw } from "./underpaid-prisma-raw.js";

/**
 * Sum `amount` (atomic integer strings) for deposits on this checkout session,
 * optionally excluding one on-chain row (the tx currently being upserted).
 *
 * @param {number} walletInternalId
 * @param {string} depositSessionKey
 * @param {{ chain: import("@prisma/client").Chain, txHash: string, logIndex: number } | null} excludeOnChainKey
 * @returns {Promise<bigint>}
 */
export async function sumInboundAtomicForSessionExcluding(
  walletInternalId,
  depositSessionKey,
  excludeOnChainKey,
) {
  const k =
    typeof depositSessionKey === "string" && depositSessionKey.trim()
      ? depositSessionKey.trim()
      : "";
  if (!k) return 0n;
  const rows = prismaClientKnowsTxStatusUnderpaid()
    ? await prisma.transaction.findMany({
        where: {
          walletId: walletInternalId,
          depositSessionKey: k,
          status: {
            in: [TxStatus.pending, TxStatus.success, TxStatus.underpaid],
          },
          ...ACTIVE,
        },
        select: { amount: true, chain: true, txHash: true, logIndex: true },
      })
    : await selectSessionInboundAmountRowsRaw(prisma, {
        walletId: walletInternalId,
        depositSessionKey: k,
      });
  let sum = 0n;
  for (const r of rows) {
    if (
      excludeOnChainKey &&
      r.chain === excludeOnChainKey.chain &&
      r.txHash === excludeOnChainKey.txHash &&
      r.logIndex === excludeOnChainKey.logIndex
    ) {
      continue;
    }
    try {
      sum += BigInt(String(r.amount ?? "0").trim());
    } catch {
      /* skip malformed row */
    }
  }
  return sum;
}

/**
 * Expected checkout amount for a `deposit-address` session (from `WalletAssignmentEvent`).
 *
 * @param {number} walletInternalId
 * @param {string | null | undefined} depositSessionKey
 * @returns {Promise<string | null>}
 */
export async function expectedAtomicForDepositSession(
  walletInternalId,
  depositSessionKey,
) {
  const k =
    typeof depositSessionKey === "string" && depositSessionKey.trim()
      ? depositSessionKey.trim()
      : "";
  if (!k) return null;
  const ev = await prisma.walletAssignmentEvent.findFirst({
    where: {
      walletId: walletInternalId,
      depositSessionKey: k,
      ...ACTIVE,
    },
    select: { expectedAmountAtomic: true },
  });
  const a = ev?.expectedAmountAtomic;
  if (typeof a !== "string" || !a.trim()) return null;
  const t = a.trim();
  if (!/^\d+$/.test(t)) return null;
  return t;
}

