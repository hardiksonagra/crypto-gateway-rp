import { Chain } from "@prisma/client";
import { utils } from "tronweb";
import { confirmationsForChain } from "../../config/chains.js";
import { env, getTrc20Contracts } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import {
  nativeDecimalsForChain,
  nativeSymbolForChain,
} from "../native-symbols.js";
import {
  loadWatchedAddresses,
  upsertIncomingTransaction,
} from "../payment/transaction-upsert.js";

type TronGridTx = {
  txID?: string;
  raw_data?: {
    contract?: Array<{
      type?: string;
      parameter?: { value?: Record<string, unknown> };
    }>;
  };
};

type TronGridTrc20 = {
  transaction_id?: string;
  from?: string;
  to?: string;
  value?: string;
  token_info?: { symbol?: string; decimals?: number; address?: string };
};

function tronAddrEq(a: string, b: string): boolean {
  try {
    return utils.address.toHex(a) === utils.address.toHex(b);
  } catch {
    return a === b;
  }
}

function tronHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (env.tronApiKey) h["TRON-PRO-API-KEY"] = env.tronApiKey;
  return h;
}

/** TronGrid returns base58 contract ids; env keys may vary — match via hex. */
function buildTrc20Lookup(
  cfg: Record<string, { symbol: string; decimals: number }>,
): Map<string, { symbol: string; decimals: number }> {
  const map = new Map<string, { symbol: string; decimals: number }>();
  for (const [k, meta] of Object.entries(cfg)) {
    map.set(k, meta);
    try {
      const hex = utils.address.toHex(k);
      map.set(hex, meta);
      map.set(hex.toLowerCase(), meta);
    } catch {
      /* invalid key, keep raw only */
    }
  }
  return map;
}

function lookupTrc20Meta(
  map: Map<string, { symbol: string; decimals: number }>,
  contract: string,
): { symbol: string; decimals: number } | undefined {
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
 * TRON indexer via TronGrid HTTP (works without holding full TronWeb provider state).
 * Polls TRX + configured TRC20 contracts for each watched deposit address.
 */
export async function scanTronChain(): Promise<void> {
  const chain = Chain.TRON;
  const watched = await loadWatchedAddresses(chain);
  if (watched.size === 0) return;

  const base = env.tronFullNode.replace(/\/$/, "");
  const trc20Map = buildTrc20Lookup(getTrc20Contracts());

  for (const { walletId, address } of watched.values()) {
    await ingestTrxForAddress(base, address, walletId, chain);
    await ingestTrc20ForAddress(base, address, walletId, chain, trc20Map);
  }
}

async function ingestTrxForAddress(
  base: string,
  address: string,
  walletId: string,
  chain: Chain,
): Promise<void> {
  const url = `${base}/v1/accounts/${address}/transactions?only_confirmed=true&limit=50`;
  let data: { data?: TronGridTx[]; success?: boolean; error?: string } = {};
  try {
    const res = await fetch(url, { headers: tronHeaders() });
    const text = await res.text();
    try {
      data = JSON.parse(text) as typeof data;
    } catch {
      logger.warn("tron trx: non-json response", {
        address,
        status: res.status,
        body: text.slice(0, 200),
      });
      return;
    }
    if (!res.ok) {
      logger.warn("tron trx: http error", {
        address,
        status: res.status,
        body: text.slice(0, 300),
      });
      return;
    }
    if (data.success === false) {
      logger.warn("tron trx: api error", { address, err: data.error });
      return;
    }
  } catch (e) {
    logger.warn("tron trx fetch failed", { address, err: String(e) });
    return;
  }

  const list = data.data ?? [];
  for (const tx of list) {
    const txid = tx.txID;
    if (!txid) continue;
    const contracts = tx.raw_data?.contract ?? [];
    for (const c of contracts) {
      if (c.type !== "TransferContract") continue;
      const v = c.parameter?.value as
        | { amount?: number | string; owner_address?: string; to_address?: string }
        | undefined;
      const amt = v?.amount;
      if (!v?.to_address || amt === undefined || amt === null || amt === "" || Number(amt) <= 0) {
        continue;
      }
      if (!tronAddrEq(String(v.to_address), address)) continue;

      await upsertIncomingTransaction({
        walletId,
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

async function ingestTrc20ForAddress(
  base: string,
  address: string,
  walletId: string,
  chain: Chain,
  trc20Map: Map<string, { symbol: string; decimals: number }>,
): Promise<void> {
  const url = `${base}/v1/accounts/${address}/transactions/trc20?only_confirmed=true&limit=50`;
  let data: { data?: TronGridTrc20[]; success?: boolean; error?: string } = {};
  try {
    const res = await fetch(url, { headers: tronHeaders() });
    const text = await res.text();
    try {
      data = JSON.parse(text) as typeof data;
    } catch {
      logger.warn("tron trc20: non-json response", {
        address,
        status: res.status,
        body: text.slice(0, 200),
      });
      return;
    }
    if (!res.ok) {
      logger.warn("tron trc20: http error", {
        address,
        status: res.status,
        body: text.slice(0, 300),
      });
      return;
    }
    if (data.success === false) {
      logger.warn("tron trc20: api error", { address, err: data.error });
      return;
    }
  } catch (e) {
    logger.warn("tron trc20 fetch failed", { address, err: String(e) });
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

    await upsertIncomingTransaction({
      walletId,
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
