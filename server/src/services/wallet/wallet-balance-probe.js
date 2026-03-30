import { Chain } from "@prisma/client";
import { Contract, JsonRpcProvider } from "ethers";
import { getAssociatedTokenAddressSync, getAccount, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import { getErc20Contracts } from "../../config/env.js";
import { re } from "../../config/runtime-env.js";
import { chainToRpcUrl, chainToStaticNetwork, isEvmChain } from "../../config/chains.js";
import { walletAcceptsEvmErc20 } from "../../config/payment-rails.js";
import { prisma } from "../../lib/prisma.js";
import { logger } from "../../lib/logger.js";
import { formatAtomicAmountString } from "../../lib/format-atomic-amount.js";
import {
  acquireOutboundRpcSlot,
  evmRpcBudgetKey,
} from "../../lib/network-rpc-rate-limit.js";
import { postgresChainEnumHasSolana } from "../../lib/postgres-chain-enum-solana.js";
import {
  createReadOnlyTronWeb,
  tronFullNodeHostnameForLog,
} from "../../lib/tron-node-client.js";
import {
  pickUsdtTrc20Contract,
  readTronUsdtBalanceAtomicForWallet,
} from "../sweep/tron-usdt-sweep.js";

const EVM_ERC20_ABI = ["function balanceOf(address account) view returns (uint256)"];

/**
 * @param {import("@prisma/client").Chain} chain
 * @returns {{ address: string, decimals: number } | null}
 */
function pickUsdtEvmContract(chain) {
  if (chain === Chain.ETH) {
    const raw = getErc20Contracts()[Chain.ETH] ?? {};
    for (const [addr, meta] of Object.entries(raw)) {
      if (String(meta?.symbol ?? "").toUpperCase() === "USDT") {
        return { address: String(addr).trim(), decimals: Number(meta?.decimals) || 6 };
      }
    }
    return { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 };
  }
  if (chain === Chain.BNB) {
    const raw = getErc20Contracts()[Chain.BNB] ?? {};
    for (const [addr, meta] of Object.entries(raw)) {
      if (String(meta?.symbol ?? "").toUpperCase() === "USDT") {
        return { address: String(addr).trim(), decimals: Number(meta?.decimals) || 6 };
      }
    }
    return { address: "0x55d398326f99059fF775485246999027B3197955", decimals: 6 };
  }
  const raw = getErc20Contracts()[chain] ?? {};
  for (const [addr, meta] of Object.entries(raw)) {
    if (String(meta?.symbol ?? "").toUpperCase() === "USDT") {
      return { address: String(addr).trim(), decimals: Number(meta?.decimals) || 6 };
    }
  }
  return null;
}

/**
 * @param {{
 *   address: string,
 *   chain: import("@prisma/client").Chain,
 *   currency: string,
 *   network: string,
 *   derivationIndex: number,
 * }} w
 * @returns {Promise<{ display: string | null, atomic: string | null, error: string | null }>}
 */
export async function probeWalletOnChainBalance(w) {
  const cur = String(w.currency ?? "").toUpperCase();
  const net = String(w.network ?? "").toUpperCase();

  try {
    if (w.chain === Chain.TRON && cur === "USDT" && net === "TRC20") {
      const contract = pickUsdtTrc20Contract();
      const atomic = await readTronUsdtBalanceAtomicForWallet(w, contract);
      const human = formatAtomicAmountString(atomic, 6);
      return {
        display: `${human} USDT`,
        atomic: atomic.toString(),
        error: null,
      };
    }

    if (w.chain === Chain.TRON && cur === "TRX" && net === "TRON") {
      const tw = createReadOnlyTronWeb();
      await acquireOutboundRpcSlot("TRON");
      const sun = await tw.trx.getBalance(w.address);
      const atomic = BigInt(Math.trunc(Number(sun) || 0));
      const human = formatAtomicAmountString(atomic, 6);
      return { display: `${human} TRX`, atomic: atomic.toString(), error: null };
    }

    if (isEvmChain(w.chain) && walletAcceptsEvmErc20(w.chain, w, "USDT")) {
      const token = pickUsdtEvmContract(w.chain);
      if (!token) {
        return {
          display: null,
          atomic: null,
          error: "no_usdt_contract_for_chain",
        };
      }
      const provider = new JsonRpcProvider(
        chainToRpcUrl(w.chain),
        chainToStaticNetwork(w.chain),
        { staticNetwork: true },
      );
      const contract = new Contract(token.address, EVM_ERC20_ABI, provider);
      const key = evmRpcBudgetKey(w.chain);
      await acquireOutboundRpcSlot(key);
      const bal = await contract.balanceOf(w.address);
      const atomic = BigInt(bal.toString());
      const human = formatAtomicAmountString(atomic, token.decimals);
      return {
        display: `${human} USDT`,
        atomic: atomic.toString(),
        error: null,
      };
    }

    if (
      w.chain === Chain.SOLANA &&
      cur === "USDT" &&
      net === "SPL" &&
      (await postgresChainEnumHasSolana())
    ) {
      const connection = new Connection(re.solanaRpcUrl.replace(/\/$/, ""), "confirmed");
      const mint = new PublicKey(re.solanaUsdtMint.trim());
      const owner = new PublicKey(w.address.trim());
      const ata = getAssociatedTokenAddressSync(mint, owner, false, TOKEN_PROGRAM_ID);
      await acquireOutboundRpcSlot("SOLANA");
      try {
        const acc = await getAccount(connection, ata);
        const atomic = acc.amount;
        const human = formatAtomicAmountString(atomic, 6);
        return {
          display: `${human} USDT`,
          atomic: atomic.toString(),
          error: null,
        };
      } catch (e) {
        const msg = String(e);
        if (msg.includes("could not find account") || msg.includes("TokenAccountNotFoundError")) {
          return { display: "0 USDT", atomic: "0", error: null };
        }
        throw e;
      }
    }

    return {
      display: null,
      atomic: null,
      error: "balance_probe_unsupported_rail",
    };
  } catch (e) {
    const base = {
      event: "wallet_balance_probe_failed",
      walletId: w.id,
      chain: w.chain,
      currency: w.currency,
      network: w.network,
      address: w.address,
      err: String(e),
    };
    if (w.chain === Chain.TRON) {
      Object.assign(base, {
        tron_full_node_host: tronFullNodeHostnameForLog(),
        note: "same TronWeb fullHost+headers as tron tracker JSON-RPC probe / sweep",
      });
    }
    logger.error("wallet_balance_probe_failed", base);
    return {
      display: null,
      atomic: null,
      error: String(e).slice(0, 500),
    };
  }
}

/**
 * Fetches on-chain balance for every wallet and persists cache columns.
 *
 * @returns {Promise<{ total: number, ok: number, failed: number }>}
 */
export async function refreshAllWalletCachedBalances() {
  const rows = await prisma.wallet.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      address: true,
      chain: true,
      currency: true,
      network: true,
      derivationIndex: true,
    },
  });

  let ok = 0;
  let failed = 0;
  const now = new Date();

  for (const w of rows) {
    const r = await probeWalletOnChainBalance(w);
    if (r.error) failed++;
    else ok++;

    await prisma.wallet.update({
      where: { id: w.id },
      data: {
        cachedBalanceDisplay: r.display,
        cachedBalanceAtomic: r.atomic,
        cachedBalanceError: r.error,
        cachedBalanceUpdatedAt: now,
      },
    });
  }

  return { total: rows.length, ok, failed };
}
