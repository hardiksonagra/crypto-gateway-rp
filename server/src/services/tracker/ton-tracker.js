import { Chain } from "@prisma/client";
import { Address } from "@ton/core";
import { confirmationsForChain } from "../../config/chains.js";
import { env, getTonJettonContracts } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { nativeDecimalsForChain, nativeSymbolForChain } from "../native-symbols.js";
import {
  loadWalletsForChain,
  normalizeMatchAddress,
  upsertIncomingTransaction,
} from "../payment/transaction-upsert.js";

function tonAddrEq(a, b) {
  try {
    return Address.parse(a.trim()).equals(Address.parse(b.trim()));
  } catch {
    return a.trim() === b.trim();
  }
}

function buildTonJettonMetaByRaw(cfg) {
  const map = new Map();
  for (const [k, meta] of Object.entries(cfg)) {
    try {
      const raw = Address.parse(k.trim()).toRawString();
      map.set(raw, meta);
    } catch {
      /* skip */
    }
  }
  return map;
}

function lookupJetton(map, jettonAddr) {
  try {
    return map.get(Address.parse(jettonAddr.trim()).toRawString());
  } catch {
    return undefined;
  }
}

function tonHeaders() {
  const h = { Accept: "application/json" };
  if (env.tonApiKey) h.Authorization = `Bearer ${env.tonApiKey}`;
  return h;
}

/**
 * @param {Array<{ id: string, address: string, currency: string, network: string }>} wallets
 * @returns {Map<string, typeof wallets>}
 */
function groupTonWallets(wallets) {
  const m = new Map();
  for (const w of wallets) {
    const k = normalizeMatchAddress(Chain.TON, w.address);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(w);
  }
  return m;
}

/**
 * @param {{ wallets?: Array<{ id: string, address: string, currency: string, network: string }> }} [options]
 */
export async function scanTonChain(options = {}) {
  const chain = Chain.TON;
  const wallets =
    options.wallets ?? (await loadWalletsForChain(chain));
  if (wallets.length === 0) return;

  const base = env.tonApiBase.replace(/\/$/, "");
  const jettonMeta = buildTonJettonMetaByRaw(getTonJettonContracts());
  const threshold = confirmationsForChain(chain);
  const byRaw = groupTonWallets(wallets);

  for (const group of byRaw.values()) {
    const address = group[0].address;
    const url = `${base}/v2/accounts/${encodeURIComponent(address.trim())}/events?limit=50`;
    let payload;
    try {
      const res = await fetch(url, { headers: tonHeaders() });
      const text = await res.text();
      try {
        payload = JSON.parse(text);
      } catch {
        logger.warn("ton: non-json response", {
          address,
          status: res.status,
          body: text.slice(0, 200),
        });
        continue;
      }
      if (!res.ok) {
        logger.warn("ton http error", {
          address,
          status: res.status,
          body: text.slice(0, 300),
        });
        continue;
      }
      if (payload.error) {
        logger.warn("ton: api error", { address, err: payload.error });
        continue;
      }
    } catch (e) {
      logger.warn("ton fetch failed", { address, err: String(e) });
      continue;
    }

    const events = payload.events ?? [];
    for (const event of events) {
      const eventId = event.event_id ?? "";
      if (!eventId) continue;
      const actions = event.actions ?? [];
      for (let ai = 0; ai < actions.length; ai++) {
        const action = actions[ai];
        if (action.status !== "ok") continue;

        const txHash = action.base_transactions?.[0] ?? eventId;

        if (action.type === "JettonTransfer" && action.JettonTransfer) {
          const jt = action.JettonTransfer;
          const rec = jt.recipient?.address;
          if (!rec || !jt.amount) continue;
          if (!tonAddrEq(rec, address)) continue;
          const jAddr = jt.jetton?.address;
          if (!jAddr) continue;
          const meta = lookupJetton(jettonMeta, jAddr);
          if (!meta) continue;
          const sym = String(meta.symbol).toUpperCase();
          const jettonTargets = group.filter(
            (w) => w.currency === sym && w.network === "TON",
          );
          for (const w of jettonTargets) {
            await upsertIncomingTransaction({
              walletId: w.id,
              currency: w.currency,
              network: w.network,
              txHash,
              fromAddress: jt.sender?.address ?? "",
              toAddress: address,
              amount: jt.amount,
              tokenSymbol: meta.symbol,
              tokenDecimals: jt.jetton?.decimals ?? meta.decimals,
              chain,
              confirmations: threshold,
              blockNumber: null,
              logIndex: ai,
            });
          }
          continue;
        }

        if (action.type === "TonTransfer" && action.TonTransfer) {
          const tt = action.TonTransfer;
          const rec = tt.recipient?.address;
          if (!rec || tt.amount === undefined || tt.amount === null) continue;
          if (!tonAddrEq(rec, address)) continue;

          const nativeTargets = group.filter(
            (w) => w.currency === "TON" && w.network === "TON",
          );
          for (const w of nativeTargets) {
            await upsertIncomingTransaction({
              walletId: w.id,
              currency: w.currency,
              network: w.network,
              txHash,
              fromAddress: tt.sender?.address ?? "",
              toAddress: address,
              amount: String(tt.amount),
              tokenSymbol: nativeSymbolForChain(chain),
              tokenDecimals: nativeDecimalsForChain(chain),
              chain,
              confirmations: threshold,
              blockNumber: null,
              logIndex: ai,
            });
          }
        }
      }
    }
  }
}
