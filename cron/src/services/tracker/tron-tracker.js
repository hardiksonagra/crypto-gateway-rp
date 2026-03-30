import { Chain } from "@prisma/client";
import { utils } from "tronweb";
import { confirmationsForChain } from "crypto-payment-gateway/src/config/chains.js";
import { getTrc20Contracts } from "crypto-payment-gateway/src/config/env.js";
import { re } from "crypto-payment-gateway/src/config/runtime-env.js";
import { logger } from "crypto-payment-gateway/src/lib/logger.js";
import { acquireOutboundRpcSlot } from "crypto-payment-gateway/src/lib/network-rpc-rate-limit.js";
import {
  nativeDecimalsForChain,
  nativeSymbolForChain,
} from "crypto-payment-gateway/src/services/native-symbols.js";
import {
  loadWalletsForChain,
  upsertIncomingTransaction,
} from "crypto-payment-gateway/src/services/payment/transaction-upsert.js";

function tronAddrEq(a, b) {
  try {
    return utils.address.toHex(a) === utils.address.toHex(b);
  } catch {
    return a === b;
  }
}

function tronGroupKey(address) {
  try {
    return utils.address.toHex(address);
  } catch {
    return address;
  }
}

function tronHeaders() {
  const h = { "Content-Type": "application/json" };
  if (re.tronApiKey) h["TRON-PRO-API-KEY"] = re.tronApiKey;
  return h;
}

/** Safe host for logs (no path token). */
function tronRestApiHostForLog() {
  try {
    const u = new URL(re.tronAccountApiBase.replace(/\/$/, ""));
    return u.hostname;
  } catch {
    return "tron_rest_base_invalid";
  }
}

function buildTrc20Lookup(cfg) {
  const map = new Map();
  for (const [k, meta] of Object.entries(cfg)) {
    map.set(k, meta);
    try {
      const hex = utils.address.toHex(k);
      map.set(hex, meta);
      map.set(hex.toLowerCase(), meta);
    } catch {
      /* invalid key */
    }
  }
  return map;
}

function lookupTrc20Meta(map, contract) {
  const direct = map.get(contract);
  if (direct) return direct;
  try {
    const hex = utils.address.toHex(contract);
    return map.get(hex) ?? map.get(hex.toLowerCase());
  } catch {
    return undefined;
  }
}

/**
 * @param {{ wallets?: Array<{ id: string, address: string, currency: string, network: string }> }} [options]
 */
export async function scanTronChain(options = {}) {
  const chain = Chain.TRON;
  const wallets =
    options.wallets ?? (await loadWalletsForChain(chain));
  if (wallets.length === 0) return;

  const base = re.tronAccountApiBase.replace(/\/$/, "");
  const trc20Map = buildTrc20Lookup(getTrc20Contracts());

  const byHex = new Map();
  for (const w of wallets) {
    const k = tronGroupKey(w.address);
    if (!byHex.has(k)) byHex.set(k, []);
    byHex.get(k).push(w);
  }

  for (const group of byHex.values()) {
    const address = group[0].address;
    const trxTargets = group.filter((w) => w.currency === "TRX" && w.network === "TRON");
    const usdtTargets = group.filter((w) => w.currency === "USDT" && w.network === "TRC20");
    if (trxTargets.length) {
      await ingestTrxForTargets(base, address, trxTargets, chain);
    }
    if (usdtTargets.length) {
      await ingestTrc20ForTargets(base, address, usdtTargets, chain, trc20Map);
    }
  }
}

/**
 * @param {string} base
 * @param {string} address
 * @param {Array<{ id: string }>} targets
 * @param {import("@prisma/client").Chain} chain
 */
async function ingestTrxForTargets(base, address, targets, chain) {
  const url = `${base}/v1/accounts/${address}/transactions?only_confirmed=true&limit=50`;
  let data = {};
  try {
    await acquireOutboundRpcSlot("TRON");
    const res = await fetch(url, { headers: tronHeaders() });
    const text = await res.text();
    try {
      data = JSON.parse(text);
    } catch {
      logger.error("tron_trx_rest_non_json", {
        event: "tron_trx_rest_non_json",
        rail: "TRON_TRX",
        address,
        httpStatus: res.status,
        tron_rest_host: tronRestApiHostForLog(),
        body_preview: text.slice(0, 400),
      });
      return;
    }
    if (!res.ok) {
      logger.error("tron_trx_rest_http_error", {
        event: "tron_trx_rest_http_error",
        rail: "TRON_TRX",
        address,
        httpStatus: res.status,
        tron_rest_host: tronRestApiHostForLog(),
        body_preview: text.slice(0, 400),
      });
      return;
    }
    if (data.success === false) {
      logger.error("tron_trx_rest_api_error", {
        event: "tron_trx_rest_api_error",
        rail: "TRON_TRX",
        address,
        tron_rest_host: tronRestApiHostForLog(),
        api_error: data.error,
      });
      return;
    }
  } catch (e) {
    logger.error("tron_trx_rest_fetch_failed", {
      event: "tron_trx_rest_fetch_failed",
      rail: "TRON_TRX",
      address,
      tron_rest_host: tronRestApiHostForLog(),
      err: String(e),
    });
    return;
  }

  const list = data.data ?? [];
  for (const tx of list) {
    const txid = tx.txID;
    if (!txid) continue;
    const contracts = tx.raw_data?.contract ?? [];
    for (const c of contracts) {
      if (c.type !== "TransferContract") continue;
      const v = c.parameter?.value;
      const amt = v?.amount;
      if (!v?.to_address || amt === undefined || amt === null || amt === "" || Number(amt) <= 0) {
        continue;
      }
      if (!tronAddrEq(String(v.to_address), address)) continue;

      for (const w of targets) {
        await upsertIncomingTransaction({
          walletId: w.id,
          currency: w.currency,
          network: w.network,
          txHash: txid,
          fromAddress: v.owner_address ?? "",
          toAddress: address,
          amount: String(amt),
          tokenSymbol: nativeSymbolForChain(chain),
          tokenDecimals: nativeDecimalsForChain(chain),
          chain,
          confirmations: confirmationsForChain(chain),
          blockNumber: null,
          logIndex: -1,
        });
      }
    }
  }
}

/**
 * @param {string} base
 * @param {string} address
 * @param {Array<{ id: string }>} targets
 * @param {import("@prisma/client").Chain} chain
 * @param {Map<string, { symbol: string, decimals: number }>} trc20Map
 */
async function ingestTrc20ForTargets(base, address, targets, chain, trc20Map) {
  const url = `${base}/v1/accounts/${address}/transactions/trc20?only_confirmed=true&limit=50`;
  let data = {};
  try {
    await acquireOutboundRpcSlot("TRON");
    const res = await fetch(url, { headers: tronHeaders() });
    const text = await res.text();
    try {
      data = JSON.parse(text);
    } catch {
      logger.error("tron_trc20_rest_non_json", {
        event: "tron_trc20_rest_non_json",
        rail: "TRON_TRC20",
        address,
        httpStatus: res.status,
        tron_rest_host: tronRestApiHostForLog(),
        body_preview: text.slice(0, 400),
      });
      return;
    }
    if (!res.ok) {
      logger.error("tron_trc20_rest_http_error", {
        event: "tron_trc20_rest_http_error",
        rail: "TRON_TRC20",
        address,
        httpStatus: res.status,
        tron_rest_host: tronRestApiHostForLog(),
        body_preview: text.slice(0, 400),
      });
      return;
    }
    if (data.success === false) {
      logger.error("tron_trc20_rest_api_error", {
        event: "tron_trc20_rest_api_error",
        rail: "TRON_TRC20",
        address,
        tron_rest_host: tronRestApiHostForLog(),
        api_error: data.error,
      });
      return;
    }
  } catch (e) {
    logger.error("tron_trc20_rest_fetch_failed", {
      event: "tron_trc20_rest_fetch_failed",
      rail: "TRON_TRC20",
      address,
      tron_rest_host: tronRestApiHostForLog(),
      err: String(e),
    });
    return;
  }

  for (const row of data.data ?? []) {
    const txid = row.transaction_id;
    if (!txid || !row.to || !row.value) continue;
    if (!tronAddrEq(String(row.to), address)) continue;
    const contract = row.token_info?.address;
    if (!contract) continue;
    const cfg = lookupTrc20Meta(trc20Map, contract);
    if (!cfg) continue;
    if (String(cfg.symbol).toUpperCase() !== "USDT") continue;

    for (const w of targets) {
      await upsertIncomingTransaction({
        walletId: w.id,
        currency: w.currency,
        network: w.network,
        txHash: txid,
        fromAddress: row.from ?? "",
        toAddress: address,
        amount: row.value,
        tokenSymbol: cfg.symbol,
        tokenDecimals: row.token_info?.decimals ?? cfg.decimals,
        chain,
        confirmations: confirmationsForChain(chain),
        blockNumber: null,
        logIndex: -1,
      });
    }
  }
}
