import { Chain } from "@prisma/client";
import { ethers } from "ethers";
import {
  chainToRpcUrl,
  chainToStaticNetwork,
  isEvmChain,
} from "crypto-payment-gateway/src/config/chains.js";
import { getErc20Contracts } from "crypto-payment-gateway/src/config/env.js";
import {
  walletAcceptsEvmErc20,
  walletAcceptsEvmNative,
} from "crypto-payment-gateway/src/config/payment-rails.js";
import { re } from "crypto-payment-gateway/src/config/runtime-env.js";
import { logger } from "crypto-payment-gateway/src/lib/logger.js";
import {
  acquireOutboundRpcSlot,
  evmRpcBudgetKey,
} from "crypto-payment-gateway/src/lib/network-rpc-rate-limit.js";
import {
  nativeDecimalsForChain,
  nativeSymbolForChain,
} from "crypto-payment-gateway/src/services/native-symbols.js";
import { pickSingleDepositWallet } from "crypto-payment-gateway/src/lib/deposit-scan-dedupe.js";
import {
  advanceScanner,
  getOrInitScannerBlock,
  loadWalletsForChain,
  normalizeMatchAddress,
  upsertIncomingTransaction,
} from "crypto-payment-gateway/src/services/payment/transaction-upsert.js";
import { recordDepositScanPolledAddresses } from "crypto-payment-gateway/src/services/tracker/deposit-rail-metrics.js";

const transferTopic = ethers.id("Transfer(address,address,uint256)");
const erc20Iface = new ethers.Interface([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

function chainConfigKey(chain) {
  return chain;
}

/**
 * Etherscan API v2 `chainid` for deposit scanner (ETH + BNB only).
 * @param {import("@prisma/client").Chain} chain
 * @returns {number | null}
 */
function etherscanChainId(chain) {
  if (chain === Chain.ETH) return 1;
  if (chain === Chain.BNB) return 56;
  return null;
}

/**
 * @param {Record<string, unknown>} row Etherscan `getLogs` row
 * @returns {{ address: string, topics: string[], data: string, transactionHash: string, index: number }}
 */
function etherscanRowToLogLike(row) {
  const topics = Array.isArray(row.topics)
    ? row.topics.map((t) => String(t))
    : [];
  const rawIdx = row.logIndex;
  let index = 0;
  if (typeof rawIdx === "number" && Number.isFinite(rawIdx)) {
    index = rawIdx;
  } else if (typeof rawIdx === "string") {
    const t = rawIdx.trim();
    if (t.startsWith("0x")) index = Number.parseInt(t, 16);
    else index = Number.parseInt(t, 10);
    if (!Number.isFinite(index)) index = 0;
  }
  return {
    address: String(row.address ?? ""),
    topics,
    data: String(row.data ?? "0x"),
    transactionHash: String(row.transactionHash ?? ""),
    index,
  };
}

/**
 * Paginated Etherscan `module=logs&action=getLogs` for a single block (Transfer topic0 only).
 *
 * @param {import("@prisma/client").Chain} chain
 * @param {bigint} blockNum
 * @param {string} topic0
 * @param {string} budgetKey
 * @returns {Promise<Array<{ address: string, topics: string[], data: string, transactionHash: string, index: number }>>}
 */
async function fetchTransferLogsViaEtherscan(chain, blockNum, topic0, budgetKey) {
  const apiKey = re.etherscanApiKey?.trim();
  const chainId = etherscanChainId(chain);
  if (!apiKey || chainId == null) return [];

  const base = re.etherscanApiBase.replace(/\/$/, "");
  const blockStr = blockNum.toString();
  const out = [];
  const offset = 1000;
  const maxPages = 50;

  for (let page = 1; page <= maxPages; page += 1) {
    await acquireOutboundRpcSlot(budgetKey);
    const u = new URL(base.includes("://") ? base : `https://${base}`);
    u.searchParams.set("chainid", String(chainId));
    u.searchParams.set("module", "logs");
    u.searchParams.set("action", "getLogs");
    u.searchParams.set("fromBlock", blockStr);
    u.searchParams.set("toBlock", blockStr);
    u.searchParams.set("topic0", topic0);
    u.searchParams.set("page", String(page));
    u.searchParams.set("offset", String(offset));
    u.searchParams.set("apikey", apiKey);

    const res = await fetch(u.toString(), { method: "GET" });
    if (!res.ok) {
      throw new Error(`etherscan_http_${res.status}`);
    }
    /** @type {{ status?: string, message?: string, result?: unknown }} */
    const j = await res.json();
    if (j.status === "0") {
      const msg = String(j.message ?? "").toLowerCase();
      if (msg.includes("no records") || msg.includes("no transactions")) {
        break;
      }
      const errPart =
        typeof j.result === "string" ? j.result : JSON.stringify(j.result);
      throw new Error(`etherscan_${j.message ?? "error"}:${errPart}`);
    }
    const batch = Array.isArray(j.result) ? j.result : [];
    for (const row of batch) {
      if (row && typeof row === "object") {
        out.push(etherscanRowToLogLike(/** @type {Record<string, unknown>} */ (row)));
      }
    }
    if (batch.length < offset) break;
  }

  return out;
}

/**
 * @param {import("@prisma/client").Chain} chain
 * @param {Array<{ id: string, address: string, currency: string, network: string }>} wallets
 * @returns {Map<string, typeof wallets>}
 */
function groupWalletsByNormalizedAddress(chain, wallets) {
  const m = new Map();
  for (const w of wallets) {
    const k = normalizeMatchAddress(chain, w.address);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(w);
  }
  return m;
}

/**
 * @param {import("@prisma/client").Chain} chain
 * @param {{ wallets?: Array<{ id: string, address: string, currency: string, network: string }> }} [options]
 */
export async function scanEvmChain(chain, options = {}) {
  if (!isEvmChain(chain)) return;

  const network = chainToStaticNetwork(chain);
  const provider = new ethers.JsonRpcProvider(chainToRpcUrl(chain), network, {
    staticNetwork: network,
  });
  const budgetKey = evmRpcBudgetKey(chain);
  await acquireOutboundRpcSlot(budgetKey);
  const tip = BigInt(await provider.getBlockNumber());
  let cursor = await getOrInitScannerBlock(chain, tip);
  if (cursor >= tip) return;

  const walletRows =
    options.wallets ?? (await loadWalletsForChain(chain));
  if (walletRows.length === 0) {
    await advanceScanner(chain, tip);
    return;
  }

  const uniqueAddrs = [...new Set(walletRows.map((w) => w.address))];
  recordDepositScanPolledAddresses(chain, uniqueAddrs);

  const byAddr = groupWalletsByNormalizedAddress(chain, walletRows);

  const rawErc20 = getErc20Contracts()[chainConfigKey(chain)] ?? {};
  const erc20Map = {};
  for (const [addr, meta] of Object.entries(rawErc20)) {
    erc20Map[addr.toLowerCase()] = meta;
  }

  const maxBatch = 8n;
  const end = tip < cursor + maxBatch ? tip : cursor + maxBatch;

  for (let b = cursor + 1n; b <= end; b++) {
    await acquireOutboundRpcSlot(budgetKey);
    const block = await provider.getBlock(b, true);
    if (!block) continue;

    const txs = block.prefetchedTransactions;
    if (txs.length === 0 && block.transactions.length > 0) {
      logger.warn(
        "evm block missing full transactions — native deposits skipped; use an RPC that supports eth_getBlockByNumber(full=true)",
        { chain, block: b.toString() },
      );
    }

    for (const tx of txs) {
      if (!tx || tx.to == null) continue;
      const to = normalizeMatchAddress(chain, tx.to);
      const group = byAddr.get(to);
      if (!group?.length) continue;
      const val = tx.value ?? 0n;
      if (val <= 0n) continue;

      const sym = nativeSymbolForChain(chain);
      const nativeMatches = group.filter((w) =>
        walletAcceptsEvmNative(chain, w),
      );
      const w = pickSingleDepositWallet(nativeMatches, {
        chain,
        tx_hash: tx.hash,
        block: b.toString(),
        kind: "evm_native",
      });
      if (!w) continue;
      await upsertIncomingTransaction({
        walletId: w.id,
        currency: w.currency,
        network: w.network,
        txHash: tx.hash,
        fromAddress: tx.from ?? "",
        toAddress: w.address,
        amount: val.toString(),
        tokenSymbol: sym,
        tokenDecimals: nativeDecimalsForChain(chain),
        chain,
        confirmations: Number(tip - b + 1n),
        blockNumber: b,
        logIndex: -1,
      });
    }

    let logs = [];
    try {
      await acquireOutboundRpcSlot(budgetKey);
      logs = await provider.getLogs({
        fromBlock: b,
        toBlock: b,
        topics: [transferTopic],
      });
    } catch (e) {
      logger.warn("evm getLogs failed", { chain, block: b.toString(), err: String(e) });
      if (re.etherscanApiKey?.trim()) {
        try {
          logs = await fetchTransferLogsViaEtherscan(
            chain,
            b,
            transferTopic,
            budgetKey,
          );
          if (logs.length > 0) {
            logger.info("evm_get_logs_etherscan_fallback", {
              chain,
              block: b.toString(),
              log_count: logs.length,
            });
          }
        } catch (e2) {
          logger.warn("evm_get_logs_etherscan_fallback_failed", {
            chain,
            block: b.toString(),
            err: String(e2),
          });
        }
      }
    }

    for (const log of logs) {
      const contract = log.address.toLowerCase();
      const meta = erc20Map[contract];
      if (!meta) continue;

      let parsed = null;
      try {
        parsed = erc20Iface.parseLog(log);
      } catch {
        continue;
      }
      if (!parsed || parsed.name !== "Transfer") continue;
      const toAddr = normalizeMatchAddress(chain, String(parsed.args.to));
      const group = byAddr.get(toAddr);
      if (!group?.length) continue;
      const amount = parsed.args.value;
      const tokenSym = String(meta.symbol).toUpperCase();

      const erc20Matches = group.filter((w) =>
        walletAcceptsEvmErc20(chain, w, tokenSym),
      );
      const w = pickSingleDepositWallet(erc20Matches, {
        chain,
        tx_hash: log.transactionHash,
        log_index: log.index,
        block: b.toString(),
        kind: "evm_erc20",
        token: tokenSym,
      });
      if (!w) continue;
      await upsertIncomingTransaction({
        walletId: w.id,
        currency: w.currency,
        network: w.network,
        txHash: log.transactionHash,
        fromAddress: String(parsed.args.from),
        toAddress: w.address,
        amount: amount.toString(),
        tokenSymbol: meta.symbol,
        tokenDecimals: meta.decimals,
        chain,
        confirmations: Number(tip - b + 1n),
        blockNumber: b,
        logIndex: log.index,
      });
    }

    await advanceScanner(chain, b);
  }
}
