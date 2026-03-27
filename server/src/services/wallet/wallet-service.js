import { Chain } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";

/** @typedef {import("@prisma/client").Prisma.TransactionClient} DbClient */
import { env } from "../../config/env.js";
import { nextScanExpiresAt } from "../../lib/wallet-scan.js";
import { isEvmChain } from "../../config/chains.js";
import { deriveEvmAddress } from "./evm-wallet.js";
import { deriveTronAddress } from "./tron-wallet.js";
import { deriveBtcAddress } from "./btc-wallet.js";
import { deriveTonAddress } from "./ton-wallet.js";

/**
 * @param {string} userId
 * @param {import("@prisma/client").Chain} chain
 * @param {string} currency
 * @param {string} network
 * @param {DbClient} [db] — pass interactive transaction client so user+wallet commit/rollback together
 */
export async function createOrGetWallet(userId, chain, currency, network, db = prisma) {
  /** Same user+rail → same row; no extra chain RPC on repeat `deposit-address` calls. */
  const hit = await db.wallet.findUnique({
    where: {
      userId_chain_currency_network: { userId, chain, currency, network },
    },
  });
  if (hit) return hit;

  const user = await db.user.findUnique({
    where: { id: userId },
    include: { wallets: true },
  });
  if (!user) throw new Error("USER_NOT_FOUND");

  const accountIndex = user.accountIndex;

  const evmExisting = user.wallets.find((w) => isEvmChain(w.chain));
  if (isEvmChain(chain) && evmExisting) {
    return db.wallet.create({
      data: {
        userId,
        chain,
        currency,
        network,
        address: evmExisting.address,
        derivationIndex: evmExisting.derivationIndex,
        scanExpiresAt: nextScanExpiresAt(),
      },
    });
  }

  let address;
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

  return db.wallet.create({
    data: {
      userId,
      chain,
      currency,
      network,
      address,
      derivationIndex: accountIndex,
      scanExpiresAt: nextScanExpiresAt(),
    },
  });
}
