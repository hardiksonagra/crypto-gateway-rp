import { randomBytes } from "node:crypto";
import { Chain, MerchantGatewayEnv } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { confirmationsForChain } from "../../config/chains.js";
import { nativeDecimalsForChain, nativeSymbolForChain } from "../native-symbols.js";
import { upsertIncomingTransaction } from "./transaction-upsert.js";

/**
 * @param {import("@prisma/client").Chain} chain
 * @returns {string}
 */
function sandboxFromAddress(chain) {
  switch (chain) {
    case Chain.TRON:
      return "TSANDBOX111111111111111111111";
    case Chain.BTC:
      return "1SandboxTest111111111111111111111";
    case Chain.TON:
      return "EQD__________________________________________0vo";
    case Chain.SOLANA:
      return "SoSANDBOX1111111111111111111111111111111111";
    default:
      return "0x0000000000000000000000000000000000000001";
  }
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
  if (c === "TRX") {
    return {
      tokenSymbol: "TRX",
      tokenDecimals: nativeDecimalsForChain(Chain.TRON),
    };
  }
  return {
    tokenSymbol: nativeSymbolForChain(wallet.chain),
    tokenDecimals: nativeDecimalsForChain(wallet.chain),
  };
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
 * @param {{ merchantId: string, walletId: string, amount?: string }} input
 * @returns {Promise<{ transaction_id: string, tx_hash: string, amount: string, token_symbol: string, wallet_id: string }>}
 */
export async function simulateSandboxDeposit(input) {
  const wallet = await prisma.wallet.findFirst({
    where: {
      id: input.walletId,
      user: {
        merchantId: input.merchantId,
        environment: MerchantGatewayEnv.sandbox,
      },
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
    where: { walletId: wallet.id, txHash },
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
