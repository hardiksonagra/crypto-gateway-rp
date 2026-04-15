import { Chain } from "@prisma/client";
import { getErc20Contracts } from "../../config/env.js";
import { re } from "../../config/runtime-env.js";
import { isEvmChain } from "../../config/chains.js";
import { walletAcceptsEvmErc20 } from "../../config/payment-rails.js";
import { ACTIVE } from "../../lib/active-row.js";
import { prisma } from "../../lib/prisma.js";
import { isChainLiveForPlatform } from "../../lib/chain-enable.js";
import { logger } from "../../lib/logger.js";
import { formatAtomicAmountString } from "../../lib/format-atomic-amount.js";
import {
  acquireOutboundRpcSlot,
  evmRpcBudgetKey,
} from "../../lib/network-rpc-rate-limit.js";
import {
  tronFullNodeHostnameForLog,
  tronscanApiHostnameForLog,
} from "../../lib/tron-node-client.js";
import { readTronBalanceAtomicViaTronscan } from "../../lib/tronscan-account-balance.js";
import {
  etherscanApiHostnameForLog,
  fetchErc20BalanceAtomicViaEtherscan,
} from "../../lib/etherscan-client.js";
import { pickUsdtTrc20Contract } from "../sweep/tron-usdt-sweep.js";

/**
 * @param {import("@prisma/client").Chain} chain
 * @returns {{ address: string, decimals: number } | null}
 */
function pickUsdtEvmContract(chain) {
  if (chain !== Chain.ETH) return null;
  const raw = getErc20Contracts()[Chain.ETH] ?? {};
  for (const [addr, meta] of Object.entries(raw)) {
    if (String(meta?.symbol ?? "").toUpperCase() === "USDT") {
      return { address: String(addr).trim(), decimals: Number(meta?.decimals) || 6 };
    }
  }
  return { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 };
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

  if (!isChainLiveForPlatform(re.chainEnabledRecord, w.chain)) {
    return {
      display: null,
      atomic: null,
      error: "chain_disabled_for_platform",
    };
  }

  try {
    if (w.chain === Chain.TRON && cur === "USDT" && net === "TRC20") {
      const contract = pickUsdtTrc20Contract();
      const atomic = await readTronBalanceAtomicViaTronscan(w.address, "USDT", contract);
      const human = formatAtomicAmountString(atomic, 6);
      return {
        display: `${human} USDT`,
        atomic: atomic.toString(),
        error: null,
      };
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
      if (!re.etherscanApiKey?.trim()) {
        return {
          display: null,
          atomic: null,
          error: "etherscan_api_key_required_for_eth_usdt_balance",
        };
      }
      const key = evmRpcBudgetKey(w.chain);
      const atomic = await fetchErc20BalanceAtomicViaEtherscan({
        chainId: 1,
        tokenContract: token.address,
        walletAddress: w.address,
        budgetKey: key,
      });
      const human = formatAtomicAmountString(atomic, token.decimals);
      return {
        display: `${human} USDT`,
        atomic: atomic.toString(),
        error: null,
      };
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
        tronscan_api_host: tronscanApiHostnameForLog(),
        tron_full_node_host: tronFullNodeHostnameForLog(),
        note: "TRON admin balance refresh uses TronScan /api/account (TRONSCAN_API_KEY)",
      });
    }
    if (w.chain === Chain.ETH) {
      Object.assign(base, {
        etherscan_host: etherscanApiHostnameForLog(),
        note: "ETH USDT admin balance uses Etherscan tokenbalance (ETHERSCAN_API_KEY)",
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
    where: { ...ACTIVE },
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
