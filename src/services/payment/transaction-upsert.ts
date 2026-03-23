import { Chain, TxStatus } from "@prisma/client";
import { Address } from "@ton/core";
import { prisma } from "../../lib/prisma.js";
import { confirmationsForChain } from "../../config/chains.js";
import { notifyPaymentSuccess } from "../callback-service.js";

export type IncomingTxInput = {
  walletId: string;
  txHash: string;
  fromAddress: string;
  toAddress: string;
  amount: string;
  tokenSymbol: string;
  tokenDecimals: number;
  chain: Chain;
  confirmations: number;
  blockNumber: bigint | null;
  logIndex: number;
};

/**
 * Idempotent insert/update of observed transfers + confirmation ladder + webhook side-effect.
 */
export async function upsertIncomingTransaction(input: IncomingTxInput): Promise<void> {
  const threshold = confirmationsForChain(input.chain);
  const nextStatus: TxStatus =
    input.confirmations >= threshold ? TxStatus.success : TxStatus.pending;

  const row = await prisma.transaction.upsert({
    where: {
      tx_dedupe: {
        txHash: input.txHash,
        chain: input.chain,
        walletId: input.walletId,
        tokenSymbol: input.tokenSymbol,
        logIndex: input.logIndex,
      },
    },
    create: {
      walletId: input.walletId,
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

  if (nextStatus === TxStatus.success && !row.callbackDeliveredAt) {
    await notifyPaymentSuccess(row.id);
  }
}

export async function loadWatchedAddresses(
  chain: Chain,
): Promise<Map<string, { walletId: string; address: string }>> {
  const wallets = await prisma.wallet.findMany({
    where: { chain },
    select: { id: true, address: true },
  });
  const map = new Map<string, { walletId: string; address: string }>();
  for (const w of wallets) {
    const key = normalizeMatchAddress(chain, w.address);
    map.set(key, { walletId: w.id, address: w.address });
  }
  return map;
}

export function normalizeMatchAddress(chain: Chain, address: string): string {
  if (chain === Chain.TRON) return address;
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

export async function getOrInitScannerBlock(chain: Chain, tip: bigint): Promise<bigint> {
  const row = await prisma.scannerState.upsert({
    where: { chain },
    create: { chain, lastBlock: tip > 12n ? tip - 12n : 0n },
    update: {},
  });
  if (row.lastBlock === 0n && tip > 0n) {
    const warm = tip > 100n ? tip - 100n : 0n;
    await prisma.scannerState.update({
      where: { chain },
      data: { lastBlock: warm },
    });
    return warm;
  }
  return row.lastBlock;
}

export async function advanceScanner(chain: Chain, block: bigint): Promise<void> {
  await prisma.scannerState.update({
    where: { chain },
    data: { lastBlock: block },
  });
}
