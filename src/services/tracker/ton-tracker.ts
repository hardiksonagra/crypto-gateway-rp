import { Chain } from "@prisma/client";
import { Address } from "@ton/core";
import { confirmationsForChain } from "../../config/chains.js";
import { env, getTonJettonContracts, type Erc20Config } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { nativeDecimalsForChain, nativeSymbolForChain } from "../native-symbols.js";
import {
  loadWatchedAddresses,
  upsertIncomingTransaction,
} from "../payment/transaction-upsert.js";

type TonApiEvent = {
  event_id?: string;
  actions?: TonApiAction[];
};

type TonApiAction = {
  type?: string;
  status?: string;
  base_transactions?: string[];
  JettonTransfer?: {
    sender?: { address?: string };
    recipient?: { address?: string };
    amount?: string;
    jetton?: { address?: string; symbol?: string; decimals?: number };
  };
  TonTransfer?: {
    sender?: { address?: string };
    recipient?: { address?: string };
    amount?: number;
  };
};

function tonAddrEq(a: string, b: string): boolean {
  try {
    return Address.parse(a.trim()).equals(Address.parse(b.trim()));
  } catch {
    return a.trim() === b.trim();
  }
}

function buildTonJettonMetaByRaw(cfg: Erc20Config): Map<string, { symbol: string; decimals: number }> {
  const map = new Map<string, { symbol: string; decimals: number }>();
  for (const [k, meta] of Object.entries(cfg)) {
    try {
      const raw = Address.parse(k.trim()).toRawString();
      map.set(raw, meta);
    } catch {
      /* skip invalid */
    }
  }
  return map;
}

function lookupJetton(
  map: Map<string, { symbol: string; decimals: number }>,
  jettonAddr: string,
): { symbol: string; decimals: number } | undefined {
  try {
    return map.get(Address.parse(jettonAddr.trim()).toRawString());
  } catch {
    return undefined;
  }
}

function tonHeaders(): Record<string, string> {
  const h: Record<string, string> = { Accept: "application/json" };
  if (env.tonApiKey) h.Authorization = `Bearer ${env.tonApiKey}`;
  return h;
}

/**
 * TonAPI v2 account events: native TON + configured jettons (default: USDT).
 */
export async function scanTonChain(): Promise<void> {
  const chain = Chain.TON;
  const watched = await loadWatchedAddresses(chain);
  if (watched.size === 0) return;

  const base = env.tonApiBase.replace(/\/$/, "");
  const jettonMeta = buildTonJettonMetaByRaw(getTonJettonContracts());
  const threshold = confirmationsForChain(chain);

  for (const { walletId, address } of watched.values()) {
    const url = `${base}/v2/accounts/${encodeURIComponent(address.trim())}/events?limit=50`;
    let payload: { events?: TonApiEvent[]; error?: string };
    try {
      const res = await fetch(url, { headers: tonHeaders() });
      const text = await res.text();
      try {
        payload = JSON.parse(text) as typeof payload;
      } catch {
        logger.warn("ton: non-json response", { address, status: res.status, body: text.slice(0, 200) });
        continue;
      }
      if (!res.ok) {
        logger.warn("ton: http error", { address, status: res.status, body: text.slice(0, 300) });
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

          await upsertIncomingTransaction({
            walletId,
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
          continue;
        }

        if (action.type === "TonTransfer" && action.TonTransfer) {
          const tt = action.TonTransfer;
          const rec = tt.recipient?.address;
          if (!rec || tt.amount === undefined || tt.amount === null) continue;
          if (!tonAddrEq(rec, address)) continue;

          await upsertIncomingTransaction({
            walletId,
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
