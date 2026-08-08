import { Chain } from "@prisma/client";
import { env, getErc20Contracts } from "../../config/env.js";
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
import { hasActiveDepositScannerExplorerPool } from "../../lib/deposit-scanner-explorer-key-pool.js";

/** Space out explorer calls so bulk “Refresh balances” stays under third-party rate caps. */
const REFRESH_BALANCE_GAP_MS = 1000;

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

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
      const poolErc20 = await hasActiveDepositScannerExplorerPool("erc20");
      const envEthKey = env.etherscanApiKey?.trim() ?? "";
      if (!poolErc20 && !envEthKey) {
        return {
          display: null,
          atomic: null,
          error: "etherscan_explorer_pool_or_env_key_required_for_eth_usdt_balance",
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
        note: "TRON admin balance refresh uses TronScan /api/account (explorer pool or TRONSCAN_API_KEY in .env)",
      });
    }
    if (w.chain === Chain.ETH) {
      Object.assign(base, {
        etherscan_host: etherscanApiHostnameForLog(),
        note: "ETH USDT admin balance uses Etherscan tokenbalance (explorer pool or ETHERSCAN_API_KEY in .env)",
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
 * Fetches on-chain balance for wallets and persists cache columns.
 * Waits {@link REFRESH_BALANCE_GAP_MS} between each wallet so Etherscan / TronScan
 * are not hit in one tight burst (admin / merchant “Refresh balances”).
 *
 * @param {{
 *   onProgress?: (processed: number, total: number) => void,
 *   merchantId?: number,
 *   resellerPartnerId?: number,
 *   environment?: import("@prisma/client").MerchantGatewayEnv,
 * }} [opts]
 * @returns {Promise<{ total: number, ok: number, failed: number }>}
 */
export async function refreshAllWalletCachedBalances(opts) {
  const rows = await prisma.wallet.findMany({
    where: {
      ...ACTIVE,
      ...(opts?.merchantId != null ? { merchantId: opts.merchantId } : {}),
      ...(opts?.resellerPartnerId != null
        ? {
            merchant: {
              is: {
                resellerPartnerId: opts.resellerPartnerId,
                deletedAt: null,
              },
            },
          }
        : {}),
      ...(opts?.environment != null ? { environment: opts.environment } : {}),
    },
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

  const total = rows.length;
  opts?.onProgress?.(0, total);

  let ok = 0;
  let failed = 0;
  const now = new Date();

  for (let i = 0; i < rows.length; i++) {
    const w = rows[i];
    if (i > 0) {
      await sleep(REFRESH_BALANCE_GAP_MS);
    }
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
    opts?.onProgress?.(i + 1, total);
  }

  return { total, ok, failed };
}

/** @type {{ running: boolean, lastResult: { total: number, ok: number, failed: number } | null, lastError: string | null, scanTotal: number, scanProcessed: number }} */
const adminBulkRefreshState = {
  running: false,
  lastResult: null,
  lastError: null,
  scanTotal: 0,
  scanProcessed: 0,
};

/**
 * Snapshot for admin UI polling while a bulk balance refresh runs in the background.
 *
 * @returns {{ running: boolean, lastResult: { total: number, ok: number, failed: number } | null, lastError: string | null, scanTotal: number, scanProcessed: number }}
 */
export function getAdminBulkWalletBalanceRefreshStatus() {
  return {
    running: adminBulkRefreshState.running,
    lastResult: adminBulkRefreshState.lastResult,
    lastError: adminBulkRefreshState.lastError,
    scanTotal: adminBulkRefreshState.scanTotal,
    scanProcessed: adminBulkRefreshState.scanProcessed,
  };
}

/**
 * Starts {@link refreshAllWalletCachedBalances} in the background if idle.
 * HTTP handlers should respond immediately (202) so proxies do not time out on large wallets tables.
 *
 * @returns {{ started: true } | { started: false, reason: "in_progress" }}
 */
export function startAdminBulkWalletBalanceRefresh() {
  if (adminBulkRefreshState.running) {
    return { started: false, reason: "in_progress" };
  }
  adminBulkRefreshState.running = true;
  adminBulkRefreshState.lastResult = null;
  adminBulkRefreshState.lastError = null;
  adminBulkRefreshState.scanTotal = 0;
  adminBulkRefreshState.scanProcessed = 0;

  void (async () => {
    try {
      const result = await refreshAllWalletCachedBalances({
        onProgress: (processed, total) => {
          adminBulkRefreshState.scanTotal = total;
          adminBulkRefreshState.scanProcessed = processed;
        },
      });
      adminBulkRefreshState.lastResult = result;
      adminBulkRefreshState.scanTotal = result.total;
      adminBulkRefreshState.scanProcessed = result.total;
      logger.info("admin_wallet_balances_refreshed", {
        total: result.total,
        ok: result.ok,
        failed: result.failed,
      });
    } catch (e) {
      adminBulkRefreshState.lastError = String(e);
      logger.error("admin_wallet_balances_refresh_failed", { err: String(e) });
    } finally {
      adminBulkRefreshState.running = false;
    }
  })();

  return { started: true };
}

/** @type {Map<string, { running: boolean, lastResult: { total: number, ok: number, failed: number } | null, lastError: string | null, scanTotal: number, scanProcessed: number }>} */
const merchantBulkRefreshByKey = new Map();

/**
 * @param {number} merchantId
 * @param {import("@prisma/client").MerchantGatewayEnv} environment
 */
function merchantRefreshKey(merchantId, environment) {
  return `${merchantId}:${environment}`;
}

/**
 * @param {number} merchantId
 * @param {import("@prisma/client").MerchantGatewayEnv} environment
 */
export function getMerchantBulkWalletBalanceRefreshStatus(merchantId, environment) {
  const key = merchantRefreshKey(merchantId, environment);
  const s = merchantBulkRefreshByKey.get(key) ?? {
    running: false,
    lastResult: null,
    lastError: null,
    scanTotal: 0,
    scanProcessed: 0,
  };
  return {
    running: s.running,
    lastResult: s.lastResult,
    lastError: s.lastError,
    scanTotal: s.scanTotal,
    scanProcessed: s.scanProcessed,
  };
}

/**
 * Merchant-scoped background refresh (current portal environment only).
 *
 * @param {number} merchantId
 * @param {import("@prisma/client").MerchantGatewayEnv} environment
 * @returns {{ started: true } | { started: false, reason: "in_progress" }}
 */
export function startMerchantBulkWalletBalanceRefresh(merchantId, environment) {
  const key = merchantRefreshKey(merchantId, environment);
  let s = merchantBulkRefreshByKey.get(key);
  if (!s) {
    s = {
      running: false,
      lastResult: null,
      lastError: null,
      scanTotal: 0,
      scanProcessed: 0,
    };
    merchantBulkRefreshByKey.set(key, s);
  }
  if (s.running) {
    return { started: false, reason: "in_progress" };
  }
  s.running = true;
  s.lastResult = null;
  s.lastError = null;
  s.scanTotal = 0;
  s.scanProcessed = 0;

  void (async () => {
    try {
      const result = await refreshAllWalletCachedBalances({
        merchantId,
        environment,
        onProgress: (processed, total) => {
          s.scanTotal = total;
          s.scanProcessed = processed;
        },
      });
      s.lastResult = result;
      s.scanTotal = result.total;
      s.scanProcessed = result.total;
      logger.info("merchant_wallet_balances_refreshed", {
        merchant_id: merchantId,
        environment,
        total: result.total,
        ok: result.ok,
        failed: result.failed,
      });
    } catch (e) {
      s.lastError = String(e);
      logger.error("merchant_wallet_balances_refresh_failed", {
        merchant_id: merchantId,
        environment,
        err: String(e),
      });
    } finally {
      s.running = false;
    }
  })();

  return { started: true };
}

/** @type {Map<string, { running: boolean, lastResult: { total: number, ok: number, failed: number } | null, lastError: string | null, scanTotal: number, scanProcessed: number }>} */
const rpBulkRefreshByKey = new Map();

/**
 * @param {number} resellerPartnerId
 * @param {import("@prisma/client").MerchantGatewayEnv} environment
 */
function rpRefreshKey(resellerPartnerId, environment) {
  return `${resellerPartnerId}:${environment}`;
}

/**
 * @param {number} resellerPartnerId
 * @param {import("@prisma/client").MerchantGatewayEnv} environment
 */
export function getRpBulkWalletBalanceRefreshStatus(resellerPartnerId, environment) {
  const key = rpRefreshKey(resellerPartnerId, environment);
  const s = rpBulkRefreshByKey.get(key) ?? {
    running: false,
    lastResult: null,
    lastError: null,
    scanTotal: 0,
    scanProcessed: 0,
  };
  return {
    running: s.running,
    lastResult: s.lastResult,
    lastError: s.lastError,
    scanTotal: s.scanTotal,
    scanProcessed: s.scanProcessed,
  };
}

/**
 * RP-scoped background refresh (current portal environment; merchants under this RP only).
 *
 * @param {number} resellerPartnerId
 * @param {import("@prisma/client").MerchantGatewayEnv} environment
 * @returns {{ started: true } | { started: false, reason: "in_progress" }}
 */
export function startRpBulkWalletBalanceRefresh(resellerPartnerId, environment) {
  const key = rpRefreshKey(resellerPartnerId, environment);
  let s = rpBulkRefreshByKey.get(key);
  if (!s) {
    s = {
      running: false,
      lastResult: null,
      lastError: null,
      scanTotal: 0,
      scanProcessed: 0,
    };
    rpBulkRefreshByKey.set(key, s);
  }
  if (s.running) {
    return { started: false, reason: "in_progress" };
  }
  s.running = true;
  s.lastResult = null;
  s.lastError = null;
  s.scanTotal = 0;
  s.scanProcessed = 0;

  void (async () => {
    try {
      const result = await refreshAllWalletCachedBalances({
        resellerPartnerId,
        environment,
        onProgress: (processed, total) => {
          s.scanTotal = total;
          s.scanProcessed = processed;
        },
      });
      s.lastResult = result;
      s.scanTotal = result.total;
      s.scanProcessed = result.total;
      logger.info("rp_wallet_balances_refreshed", {
        reseller_partner_id: resellerPartnerId,
        environment,
        total: result.total,
        ok: result.ok,
        failed: result.failed,
      });
    } catch (e) {
      s.lastError = String(e);
      logger.error("rp_wallet_balances_refresh_failed", {
        reseller_partner_id: resellerPartnerId,
        environment,
        err: String(e),
      });
    } finally {
      s.running = false;
    }
  })();

  return { started: true };
}
