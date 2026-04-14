import { Chain } from "@prisma/client";
import { utils } from "tronweb";
import { confirmationsForChain } from "crypto-payment-gateway/src/config/chains.js";
import { getTrc20Contracts } from "crypto-payment-gateway/src/config/env.js";
import { re } from "crypto-payment-gateway/src/config/runtime-env.js";
import { acquireOutboundRpcSlot } from "crypto-payment-gateway/src/lib/network-rpc-rate-limit.js";
import { getTronscanFetchHeaders } from "crypto-payment-gateway/src/lib/tron-node-client.js";
import { pickSingleDepositWallet } from "crypto-payment-gateway/src/lib/deposit-scan-dedupe.js";
import {
  loadWalletsForChain,
  upsertIncomingTransaction,
} from "crypto-payment-gateway/src/services/payment/transaction-upsert.js";
import { logger } from "crypto-payment-gateway/src/lib/logger.js";
import { recordDepositScanPolledAddresses } from "crypto-payment-gateway/src/services/tracker/deposit-rail-metrics.js";
import { pickUsdtTrc20Contract } from "crypto-payment-gateway/src/services/sweep/tron-usdt-sweep.js";

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

function trc20TransferListRows(data) {
  if (Array.isArray(data)) return data;
  return data?.token_transfers ?? data?.data ?? [];
}

function rowToAddress(row) {
  return String(
    row.to_address ?? row.transferToAddress ?? row.transfer_to_address ?? "",
  );
}

function rowFromAddress(row) {
  return String(
    row.from_address ??
      row.transferFromAddress ??
      row.transfer_from_address ??
      "",
  );
}

function rowTxId(row) {
  return String(
    row.transaction_id ??
      row.transactionHash ??
      row.tx_hash ??
      row.hash ??
      row.txID ??
      "",
  ).trim();
}

/**
 * @param {{ wallets?: Array<{ id: string, address: string, currency: string, network: string }> }} [options]
 */
export async function scanTronChain(options = {}) {
  const chain = Chain.TRON;
  const wallets = options.wallets ?? (await loadWalletsForChain(chain));

  if (wallets.length === 0) return;
  if (!re.tronscanApiKey?.trim()) {
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

  /** @type {Array<{ address: string, usdtTargets: typeof wallets }>} */
  const work = [];

  for (const group of byHex.values()) {
    const address = group[0].address;
    const usdtTargets = group.filter(
      (w) => w.currency === "USDT" && w.network === "TRC20",
    );
    if (usdtTargets.length) {
      work.push({ address, usdtTargets });
    }
  }

  for (const { address, usdtTargets } of work) {
    await ingestTrc20ViaTronscan(base, address, usdtTargets, chain, trc20Map);
  }
  recordDepositScanPolledAddresses(
    Chain.TRON,
    work.map((w) => w.address),
  );
}

/**
 * TronScan: TRC20 transfers for contract + related account.
 */
async function ingestTrc20ViaTronscan(base, address, targets, chain, trc20Map) {
  let usdtContract;
  try {
    usdtContract = pickUsdtTrc20Contract();
  } catch {
    return;
  }

  // Omit `confirm` — TronScan returns empty `token_transfers` for `relatedAddress` when `confirm=true`.
  const pathLabel = "/api/token_trc20/transfers";
  const url = `${base}${pathLabel}?limit=50&start=0&contract_address=${encodeURIComponent(usdtContract)}&relatedAddress=${encodeURIComponent(address)}`;
  let data = {};
  const t0 = Date.now();
  logger.info({
    event: "explorer_api_tronscan",
    phase: "start",
    address,
    path: pathLabel,
    message: `TRC20: START API CALL (${address})`,
  });
  try {
    await acquireOutboundRpcSlot("TRON");
    const res = await fetch(url, { headers: getTronscanFetchHeaders() });
    const text = await res.text();
    const duration_ms = Date.now() - t0;
    let parse_ok = false;
    try {
      data = JSON.parse(text);
      parse_ok = true;
    } catch {
      data = {};
    }
    const ok = Boolean(res.ok && parse_ok);
    const endNote = ok ? "" : ` fail http=${res.status} parse_ok=${parse_ok}`;
    logger.info({
      event: "explorer_api_tronscan",
      phase: "end",
      address,
      path: pathLabel,
      duration_ms,
      http_status: res.status,
      ok,
      response_bytes: text.length,
      message: `TRC20: END API CALL (${address}) (${duration_ms}ms)${endNote}`,
    });
    if (!res.ok) {
      return;
    }
    if (!parse_ok) {
      return;
    }
  } catch (e) {
    const duration_ms = Date.now() - t0;
    const err = e instanceof Error ? e.message : String(e);
    logger.info({
      event: "explorer_api_tronscan",
      phase: "end",
      address,
      path: pathLabel,
      duration_ms,
      ok: false,
      error: err,
      message: `TRC20: END API CALL (${address}) (${duration_ms}ms) err=${err}`,
    });
    return;
  }

  for (const row of trc20TransferListRows(data)) {
    const to = rowToAddress(row);
    const from = rowFromAddress(row);
    const txid = rowTxId(row);
    const val = row.quant ?? row.value ?? row.amount;
    const contract =
      row.contract_address ??
      row.token_info?.contract_address ??
      row.tokenInfo?.address;
    if (!to || !txid || val === undefined || val === null) continue;
    if (!tronAddrEq(to, address)) continue;
    if (!contract) continue;
    const cfg = lookupTrc20Meta(trc20Map, String(contract));
    if (!cfg) continue;
    if (String(cfg.symbol).toUpperCase() !== "USDT") continue;

    const w = pickSingleDepositWallet(targets, {
      chain,
      tx_hash: txid,
      kind: "tron_trc20_usdt",
      deposit_address: address,
    });
    if (!w) continue;
    await upsertIncomingTransaction({
      walletId: w.id,
      currency: w.currency,
      network: w.network,
      txHash: txid,
      fromAddress: from,
      toAddress: address,
      amount: String(val),
      tokenSymbol: cfg.symbol,
      tokenDecimals:
        row.token_info?.decimals ?? row.tokenInfo?.decimals ?? cfg.decimals,
      chain,
      confirmations: confirmationsForChain(chain),
      blockNumber: null,
      logIndex: -1,
    });
  }
}
