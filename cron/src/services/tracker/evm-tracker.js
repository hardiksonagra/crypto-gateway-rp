import { Chain } from "@prisma/client";
import { ethers } from "ethers";
import { isEvmChain } from "crypto-payment-gateway/src/config/chains.js";
import { getErc20Contracts } from "crypto-payment-gateway/src/config/env.js";
import { walletAcceptsEvmErc20 } from "crypto-payment-gateway/src/config/payment-rails.js";
import { re } from "crypto-payment-gateway/src/config/runtime-env.js";
import {
  acquireDepositScannerApiSlot,
  acquireOutboundRpcSlot,
  evmRpcBudgetKey,
} from "crypto-payment-gateway/src/lib/network-rpc-rate-limit.js";
import { pickSingleDepositWallet } from "crypto-payment-gateway/src/lib/deposit-scan-dedupe.js";
import {
  advanceScanner,
  getOrInitScannerBlock,
  loadWalletsForChain,
  normalizeMatchAddress,
  upsertIncomingTransaction,
} from "crypto-payment-gateway/src/services/payment/transaction-upsert.js";
import { logger } from "crypto-payment-gateway/src/lib/logger.js";
import { recordDepositScanPolledAddresses } from "crypto-payment-gateway/src/services/tracker/deposit-rail-metrics.js";

const transferTopic = ethers.id("Transfer(address,address,uint256)");

const erc20Iface = new ethers.Interface([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

function chainConfigKey(chain) {
  return chain;
}

/**
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
 * @param {import("@prisma/client").Chain} chain
 * @param {bigint} blockNum
 * @param {string} topic0
 * @param {string} budgetKey
 * @param {string[] | null} [logAddresses] When set, log each HTTP getLogs start/end with these deposit wallet addresses.
 * @returns {Promise<Array<{ address: string, topics: string[], data: string, transactionHash: string, index: number }>>}
 */
async function fetchTransferLogsViaEtherscan(
  chain,
  blockNum,
  topic0,
  budgetKey,
  logAddresses = null,
) {
  const apiKey = re.etherscanApiKey?.trim();
  const chainId = etherscanChainId(chain);
  if (!apiKey || chainId == null) return [];

  const base = re.etherscanApiBase.replace(/\/$/, "");
  const blockStr = blockNum.toString();
  const out = [];
  const offset = 1000;
  const maxPages = 50;
  const logAddrs = Array.isArray(logAddresses) ? logAddresses : null;

  for (let page = 1; page <= maxPages; page += 1) {
    const t0 = Date.now();
    let http_status = /** @type {number | null} */ (null);
    let page_ok = false;
    let page_err = /** @type {string | null} */ (null);
    let result_count = 0;

    if (logAddrs) {
      const addrPart = logAddrs.join(",");
      logger.info({
        event: "explorer_api_etherscan",
        phase: "start",
        chain: String(chain),
        api: "getLogs",
        block: blockStr,
        page,
        addresses: logAddrs,
        message: `ERC20: START API CALL (${String(chain)} block=${blockStr} page=${page} ${addrPart})`,
      });
    }

    try {
      await acquireDepositScannerApiSlot("erc20");
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
      http_status = res.status;

      if (!res.ok) {
        throw new Error(`etherscan_http_${res.status}`);
      }
      /** @type {{ status?: string, message?: string, result?: unknown }} */
      const j = await res.json();
      if (j.status === "0") {
        const msg = String(j.message ?? "").toLowerCase();
        if (msg.includes("no records") || msg.includes("no transactions")) {
          page_ok = true;
          result_count = 0;
          break;
        }
        const errPart =
          typeof j.result === "string" ? j.result : JSON.stringify(j.result);
        throw new Error(`etherscan_${j.message ?? "error"}:${errPart}`);
      }
      const batch = Array.isArray(j.result) ? j.result : [];
      result_count = batch.length;
      page_ok = true;
      for (const row of batch) {
        if (row && typeof row === "object") {
          out.push(
            etherscanRowToLogLike(/** @type {Record<string, unknown>} */ (row)),
          );
        }
      }
      if (batch.length < offset) break;
    } catch (e) {
      page_err = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      if (logAddrs) {
        const duration_ms = Date.now() - t0;
        const ok = page_err == null && page_ok;
        const addrPart = logAddrs.join(",");
        const errNote = page_err ? ` err=${page_err}` : "";
        logger.info({
          event: "explorer_api_etherscan",
          phase: "end",
          chain: String(chain),
          api: "getLogs",
          block: blockStr,
          page,
          addresses: logAddrs,
          duration_ms,
          http_status,
          ok,
          result_count,
          ...(page_err ? { error: page_err } : {}),
          message: `ERC20: END API CALL (${String(chain)} block=${blockStr} page=${page} ${addrPart}) (${duration_ms}ms)${errNote}`,
        });
      }
    }
  }

  return out;
}

/**
 * @param {import("@prisma/client").Chain} chain
 * @param {string} budgetKey
 * @returns {Promise<bigint>}
 */
async function fetchLatestBlockNumberViaEtherscan(chain, budgetKey) {
  const apiKey = re.etherscanApiKey?.trim();
  const chainId = etherscanChainId(chain);
  if (!apiKey || chainId == null) {
    throw new Error("etherscan_blockNumber_missing_key_or_chain");
  }
  const base = re.etherscanApiBase.replace(/\/$/, "");
  const t0 = Date.now();
  let http_status = /** @type {number | null} */ (null);
  let ok = false;
  let errMsg = /** @type {string | null} */ (null);

  logger.info({
    event: "explorer_api_etherscan",
    phase: "start",
    chain: String(chain),
    api: "eth_blockNumber",
    addresses: [],
    message: `ERC20: START API CALL (${String(chain)} eth_blockNumber)`,
  });

  try {
    await acquireDepositScannerApiSlot("erc20");
    await acquireOutboundRpcSlot(budgetKey);
    const u = new URL(base.includes("://") ? base : `https://${base}`);
    u.searchParams.set("chainid", String(chainId));
    u.searchParams.set("module", "proxy");
    u.searchParams.set("action", "eth_blockNumber");
    u.searchParams.set("apikey", apiKey);

    const res = await fetch(u.toString(), { method: "GET" });
    http_status = res.status;
    if (!res.ok) {
      throw new Error(`etherscan_blockNumber_http_${res.status}`);
    }
    /** @type {{ status?: string, message?: string, result?: unknown }} */
    const j = await res.json();
    if (String(j.status ?? "") === "0") {
      const errPart =
        typeof j.result === "string" ? j.result : JSON.stringify(j.result);
      throw new Error(`etherscan_blockNumber_${j.message ?? "error"}:${errPart}`);
    }
    const raw = j.result;
    if (typeof raw !== "string") {
      throw new Error("etherscan_blockNumber_bad_result_type");
    }
    const s = raw.trim();
    if (s.startsWith("0x") || s.startsWith("0X")) {
      ok = true;
      return BigInt(s);
    }
    if (/^\d+$/.test(s)) {
      ok = true;
      return BigInt(s);
    }
    throw new Error("etherscan_blockNumber_unparseable");
  } catch (e) {
    errMsg = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    const duration_ms = Date.now() - t0;
    const errNote = errMsg ? ` err=${errMsg}` : "";
    logger.info({
      event: "explorer_api_etherscan",
      phase: "end",
      chain: String(chain),
      api: "eth_blockNumber",
      addresses: [],
      duration_ms,
      http_status,
      ok: errMsg == null && ok,
      ...(errMsg ? { error: errMsg } : {}),
      message: `ERC20: END API CALL (${String(chain)} eth_blockNumber) (${duration_ms}ms)${errNote}`,
    });
  }
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

  const budgetKey = evmRpcBudgetKey(chain);
  if (!re.etherscanApiKey?.trim()) {
    return;
  }

  const walletRows = options.wallets ?? (await loadWalletsForChain(chain));
  if (walletRows.length === 0) {
    return;
  }

  let tip;
  try {
    tip = await fetchLatestBlockNumberViaEtherscan(chain, budgetKey);
  } catch {
    return;
  }

  let cursor = await getOrInitScannerBlock(chain, tip);

  if (cursor >= tip) {
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

  const maxBatch = BigInt(re.evmDepositScanMaxBlocksPerTick);
  const end = tip < cursor + maxBatch ? tip : cursor + maxBatch;

  for (let b = cursor + 1n; b <= end; b++) {
    let logs = [];
    try {
      logs = await fetchTransferLogsViaEtherscan(
        chain,
        b,
        transferTopic,
        budgetKey,
        uniqueAddrs,
      );
    } catch {
      logs = [];
    }

    for (const log of logs) {
      const contract = log.address.toLowerCase();
      const meta = erc20Map[contract];
      if (!meta) {
        continue;
      }

      let parsed = null;
      try {
        parsed = erc20Iface.parseLog(log);
      } catch {
        continue;
      }
      if (!parsed || parsed.name !== "Transfer") {
        continue;
      }
      const toAddr = normalizeMatchAddress(chain, String(parsed.args.to));
      const group = byAddr.get(toAddr);
      if (!group?.length) {
        continue;
      }
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
      if (!w) {
        continue;
      }
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
