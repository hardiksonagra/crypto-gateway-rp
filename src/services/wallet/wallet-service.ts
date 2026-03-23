import { Chain, Wallet } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";
import { isEvmChain } from "../../config/chains.js";
import { deriveEvmAddress } from "./evm-wallet.js";
import { deriveTronAddress } from "./tron-wallet.js";
import { deriveBtcAddress } from "./btc-wallet.js";
import { deriveTonAddress } from "./ton-wallet.js";

/**
 * WalletService orchestrates per-user HD slots (user.accountIndex) across chains.
 * Architecture:
 * - EVM chains share one address per user; we still persist one row per chain for clear reconciliation.
 * - TRON/BTC use the same numeric index but different BIP44 coin types/paths.
 */
export async function createOrGetWallet(userId: string, chain: Chain): Promise<Wallet> {
  const hit = await prisma.wallet.findUnique({
    where: { userId_chain: { userId, chain } },
  });
  if (hit) return hit;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { wallets: true },
  });
  if (!user) throw new Error("USER_NOT_FOUND");

  const accountIndex = user.accountIndex;

  const evmExisting = user.wallets.find((w) => isEvmChain(w.chain));
  if (isEvmChain(chain) && evmExisting) {
    return prisma.wallet.create({
      data: {
        userId,
        chain,
        address: evmExisting.address,
        derivationIndex: evmExisting.derivationIndex,
      },
    });
  }

  let address: string;
  if (isEvmChain(chain)) {
    address = deriveEvmAddress(accountIndex);
  } else if (chain === Chain.TRON) {
    address = deriveTronAddress(accountIndex, env.mnemonic);
  } else if (chain === Chain.BTC) {
    address = deriveBtcAddress(accountIndex, env.mnemonic);
  } else if (chain === Chain.TON) {
    address = await deriveTonAddress(accountIndex, env.mnemonic);
  } else {
    throw new Error(`Unsupported chain: ${chain}`);
  }

  return prisma.wallet.create({
    data: {
      userId,
      chain,
      address,
      derivationIndex: accountIndex,
    },
  });
}
