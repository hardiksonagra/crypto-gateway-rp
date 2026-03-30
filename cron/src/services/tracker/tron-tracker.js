import { Chain } from "@prisma/client";
import { utils } from "tronweb";
import { confirmationsForChain } from "crypto-payment-gateway/src/config/chains.js";
import { getTrc20Contracts } from "crypto-payment-gateway/src/config/env.js";
import { re } from "crypto-payment-gateway/src/config/runtime-env.js";
import { logger } from "crypto-payment-gateway/src/lib/logger.js";
import { acquireOutboundRpcSlot } from "crypto-payment-gateway/src/lib/network-rpc-rate-limit.js";
import {
  getTronscanFetchHeaders,
  tronFullNodeHostnameForLog,
} from "crypto-payment-gateway/src/lib/tron-node-client.js";
import {
  nativeDecimalsForChain,
  nativeSymbolForChain,
} from "crypto-payment-gateway/src/services/native-symbols.js";
import {
  loadWalletsForChain,
  upsertIncomingTransaction,
} from "crypto-payment-gateway/src/services/payment/transaction-upsert.js";
import { recordDepositScanPolledAddresses } from "crypto-payment-gateway/src/services/tracker/deposit-rail-metrics.js";
import { pickUsdtTrc20Contract } from "crypto-payment-gateway/src/services/sweep/tron-usdt-sweep.js";

/** @type {boolean} */
let loggedMissingTronscanKey = false;

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

function tronscanHostForLog() {
  try {
    return new URL(re.tronscanApiBase.replace(/\/$/, "")).hostname;
  } catch {
    return "tronscan_base_invalid";
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

function transferListRows(data) {
  if (Array.isArray(data)) return data;
  return data?.data ?? [];
}

function trc20TransferListRows(data) {
  if (Array.isArray(data)) return data;
  return data?.token_transfers ?? data?.data ?? [];
}

function rowToAddress(row) {
  return String(row.to_address ?? row.transferToAddress ?? row.transfer_to_address ?? "");
}

function rowFromAddress(row) {
  return String(row.from_address ?? row.transferFromAddress ?? row.transfer_from_address ?? "");
}

function rowTxId(row) {
  return String(row.transaction_id ?? row.hash ?? row.txID ?? "").trim();
}

function rowTrxAmountSun(row) {
  const raw = row.amount ?? row.quant ?? row.amount_str;
  if (raw === undefined || raw === null) return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** After `token=_` TRX filter; skip obvious TRC10 rows if present. */
function rowLooksLikeTrx(row) {
  const abbr = row.token_abbr ?? row.tokenInfo?.token_abbr ?? row.token_id;
  if (abbr === undefined || abbr === null || abbr === "") return true;
  const s = String(abbr).toLowerCase();
  return s === "trx" || s === "_";
}

/**
 * @param {{ wallets?: Array<{ id: string, address: string, currency: string, network: string }> }} [options]
 */
export async function scanTronChain(options = {}) {
  const chain = Chain.TRON;
  const wallets =
    options.wallets ?? (await loadWalletsForChain(chain));
  if (wallets.length === 0) return;

  if (!re.tronscanApiKey?.trim()) {
    if (!loggedMissingTronscanKey) {
      loggedMissingTronscanKey = true;
      logger.error("tronscan_api_key_missing", {
        event: "tronscan_api_key_missing",
        note: "Set TRONSCAN_API_KEY in .env or Admin → System settings (TronScan dashboard API key).",
      });
    }
    return;
  }

  const base = re.tronscanApiBase.replace(/\/$/, "");
  const trc20Map = buildTrc20Lookup(getTrc20Contracts());

  const byHex = new Map();
  for (const w of wallets) {
    const k = tronGroupKey(w.address);
    if (!byHex.has(k)) byHex.set(k, []);
    byHex.get(k).push(w);
  }

  const polled = [];
  for (const group of byHex.values()) {
    const address = group[0].address;
    const trxTargets = group.filter((w) => w.currency === "TRX" && w.network === "TRON");
    const usdtTargets = group.filter((w) => w.currency === "USDT" && w.network === "TRC20");
    if (trxTargets.length || usdtTargets.length) polled.push(address);
    if (trxTargets.length) {
      await ingestTrxViaTronscan(base, address, trxTargets, chain);
    }
    if (usdtTargets.length) {
      await ingestTrc20ViaTronscan(base, address, usdtTargets, chain, trc20Map);
    }
  }
  recordDepositScanPolledAddresses(Chain.TRON, polled);
}

/**
 * TronScan: TRX transfers for account (`token=_` = TRX only per TronScan API doc #13).
 */
async function ingestTrxViaTronscan(base, address, targets, chain) {
  const url = `${base}/api/transfer?sort=-timestamp&limit=50&start=0&count=false&token=_&address=${encodeURIComponent(address)}`;
  let data = {};
  try {
    await acquireOutboundRpcSlot("TRON");
    const res = await fetch(url, { headers: getTronscanFetchHeaders() });
    const text = await res.text();
    try {
      data = JSON.parse(text);
    } catch {
      logger.error("tronscan_trx_non_json", {
        event: "tronscan_trx_non_json",
        rail: "TRON_TRX",
        address,
        request_url: url,
        httpStatus: res.status,
        tronscan_host: tronscanHostForLog(),
        tron_full_node_host: tronFullNodeHostnameForLog(),
        body_preview: text.slice(0, 400),
      });
      return;
    }
    if (!res.ok) {
      logger.error("tronscan_trx_http_error", {
        event: "tronscan_trx_http_error",
        rail: "TRON_TRX",
        address,
        request_url: url,
        httpStatus: res.status,
        tronscan_host: tronscanHostForLog(),
        tron_full_node_host: tronFullNodeHostnameForLog(),
        body_preview: text.slice(0, 400),
      });
      return;
    }
  } catch (e) {
    logger.error("tronscan_trx_fetch_failed", {
      event: "tronscan_trx_fetch_failed",
      rail: "TRON_TRX",
      address,
      request_url: url,
      tronscan_host: tronscanHostForLog(),
      tron_full_node_host: tronFullNodeHostnameForLog(),
      err: String(e),
    });
    return;
  }

  for (const row of transferListRows(data)) {
    const to = rowToAddress(row);
    const from = rowFromAddress(row);
    const txid = rowTxId(row);
    const sun = rowTrxAmountSun(row);
    if (!to || !txid || sun === null) continue;
    if (!tronAddrEq(to, address)) continue;
    if (!rowLooksLikeTrx(row)) continue;

    for (const w of targets) {
      await upsertIncomingTransaction({
        walletId: w.id,
        currency: w.currency,
        network: w.network,
        txHash: txid,
        fromAddress: from,
        toAddress: address,
        amount: String(Math.trunc(sun)),
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

/**
 * TronScan: TRC20 transfers for contract + related account.
 */
async function ingestTrc20ViaTronscan(base, address, targets, chain, trc20Map) {
  let usdtContract;
  try {
    usdtContract = pickUsdtTrc20Contract();
  } catch {
    logger.error("tronscan_trc20_no_usdt_contract", {
      event: "tronscan_trc20_no_usdt_contract",
      address,
      note: "Configure USDT TRC20 in env / app settings (TRC20 contracts map).",
    });
    return;
  }

  const url = `${base}/api/token_trc20/transfers?limit=50&start=0&contract_address=${encodeURIComponent(usdtContract)}&relatedAddress=${encodeURIComponent(address)}&confirm=true`;
  let data = {};
  try {
    await acquireOutboundRpcSlot("TRON");
    const res = await fetch(url, { headers: getTronscanFetchHeaders() });
    const text = await res.text();
    try {
      data = JSON.parse(text);
    } catch {
      logger.error("tronscan_trc20_non_json", {
        event: "tronscan_trc20_non_json",
        rail: "TRON_TRC20",
        address,
        request_url: url,
        httpStatus: res.status,
        tronscan_host: tronscanHostForLog(),
        tron_full_node_host: tronFullNodeHostnameForLog(),
        body_preview: text.slice(0, 400),
      });
      return;
    }
    if (!res.ok) {
      logger.error("tronscan_trc20_http_error", {
        event: "tronscan_trc20_http_error",
        rail: "TRON_TRC20",
        address,
        request_url: url,
        httpStatus: res.status,
        tronscan_host: tronscanHostForLog(),
        tron_full_node_host: tronFullNodeHostnameForLog(),
        body_preview: text.slice(0, 400),
      });
      return;
    }
  } catch (e) {
    logger.error("tronscan_trc20_fetch_failed", {
      event: "tronscan_trc20_fetch_failed",
      rail: "TRON_TRC20",
      address,
      request_url: url,
      tronscan_host: tronscanHostForLog(),
      tron_full_node_host: tronFullNodeHostnameForLog(),
      err: String(e),
    });
    return;
  }

  for (const row of trc20TransferListRows(data)) {
    const to = rowToAddress(row);
    const from = rowFromAddress(row);
    const txid = rowTxId(row);
    const val = row.quant ?? row.value ?? row.amount;
    const contract = row.contract_address ?? row.token_info?.contract_address ?? row.tokenInfo?.address;
    if (!to || !txid || val === undefined || val === null) continue;
    if (!tronAddrEq(to, address)) continue;
    if (!contract) continue;
    const cfg = lookupTrc20Meta(trc20Map, String(contract));
    if (!cfg) continue;
    if (String(cfg.symbol).toUpperCase() !== "USDT") continue;

    for (const w of targets) {
      await upsertIncomingTransaction({
        walletId: w.id,
        currency: w.currency,
        network: w.network,
        txHash: txid,
        fromAddress: from,
        toAddress: address,
        amount: String(val),
        tokenSymbol: cfg.symbol,
        tokenDecimals: row.token_info?.decimals ?? row.tokenInfo?.decimals ?? cfg.decimals,
        chain,
        confirmations: confirmationsForChain(chain),
        blockNumber: null,
        logIndex: -1,
      });
    }
  }
}
