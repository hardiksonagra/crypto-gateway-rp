import { randomBytes } from "node:crypto";
import { Chain, MerchantGatewayEnv } from "@prisma/client";
import { ACTIVE } from "../../lib/active-row.js";
import { prisma } from "../../lib/prisma.js";
import { confirmationsForChain } from "../../config/chains.js";
import { upsertIncomingTransaction } from "./transaction-upsert.js";
import { resolveWalletInternalId } from "../../lib/entity-internal-id.js";

/**
 * @param {import("@prisma/client").Chain} chain
 * @returns {string}
 */
function sandboxFromAddress(chain) {
  if (chain === Chain.TRON) {
    return "TSANDBOX111111111111111111111";
  }
  return "0x0000000000000000000000000000000000000001";
}

/**
 * @param {{ chain: import("@prisma/client").Chain, currency: string, network: string }} wallet
 * @returns {{ tokenSymbol: string, tokenDecimals: number }}
 */
function tokenMetaForWallet(wallet) {
  const c = String(wallet.currency ?? "").toUpperCase();
  if (c === "USDT") {
    return { tokenSymbol: "USDT", tokenDecimals: 6 };
  }
  throw new Error("SANDBOX_UNSUPPORTED_RAIL");
}

/**
 * One whole unit in atomic string (no float), e.g. 6 decimals → "1000000".
 * @param {number} decimals
 * @returns {string}
 */
function oneUnitAtomic(decimals) {
  const d = Math.min(Math.max(0, Math.floor(decimals)), 36);
  return String(10n ** BigInt(d));
}

/**
 * Create a synthetic confirmed deposit for merchant integration testing (no on-chain tx).
 *
 * @param {{ merchantId: number, walletId: string, amount?: string }} input
 * @returns {Promise<{ transaction_id: number, tx_hash: string, amount: string, token_symbol: string, wallet_id: number }>}
 */
export async function simulateSandboxDeposit(input) {
  const wid = await resolveWalletInternalId(String(input.walletId ?? ""));
  if (wid == null) {
    const err = new Error("WALLET_NOT_FOUND");
    /** @type {any} */ (err).code = "WALLET_NOT_FOUND";
    throw err;
  }
  const wallet = await prisma.wallet.findFirst({
    where: {
      id: wid,
      merchantId: input.merchantId,
      environment: MerchantGatewayEnv.sandbox,
      ...ACTIVE,
    },
  });
  if (!wallet) {
    const err = new Error("WALLET_NOT_FOUND");
    /** @type {any} */ (err).code = "WALLET_NOT_FOUND";
    throw err;
  }

  const { tokenSymbol, tokenDecimals } = tokenMetaForWallet(wallet);
  const rawAmt = input.amount?.trim();
  const amount = rawAmt && /^\d+$/.test(rawAmt) ? rawAmt : oneUnitAtomic(tokenDecimals);

  const chain = wallet.chain;
  const txHash = `sandbox_${Date.now()}_${randomBytes(10).toString("hex")}`;
  const threshold = confirmationsForChain(chain);

  await upsertIncomingTransaction({
    walletId: wallet.id,
    payerUserId: wallet.assignedUserId ?? undefined,
    currency: wallet.currency,
    network: wallet.network,
    txHash,
    fromAddress: sandboxFromAddress(chain),
    toAddress: wallet.address,
    amount,
    tokenSymbol,
    tokenDecimals,
    chain,
    confirmations: threshold,
    blockNumber: null,
    logIndex: -1,
  });

  const row = await prisma.transaction.findFirst({
    where: { walletId: wallet.id, txHash, ...ACTIVE },
    select: { id: true },
  });
  if (!row) {
    throw new Error("SANDBOX_TX_PERSIST_FAILED");
  }

  return {
    transaction_id: row.id,
    tx_hash: txHash,
    amount,
    token_symbol: tokenSymbol,
    wallet_id: wallet.id,
  };
}
