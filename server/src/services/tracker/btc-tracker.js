import { Chain } from "@prisma/client";
import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { nativeDecimalsForChain, nativeSymbolForChain } from "../native-symbols.js";
import { loadWatchedAddresses, upsertIncomingTransaction } from "../payment/transaction-upsert.js";

export async function scanBtcChain() {
  const chain = Chain.BTC;
  const watched = await loadWatchedAddresses(chain);
  if (watched.size === 0) return;

  const base = env.btcExplorerApiBase.replace(/\/$/, "");
  let tip = 0;
  try {
    const tipRes = await fetch(`${base}/blocks/tip/height`);
    tip = parseInt(await tipRes.text(), 10);
  } catch (e) {
    logger.warn("btc tip height failed", { err: String(e) });
    return;
  }

  for (const { walletId, address } of watched.values()) {
    let txs = [];
    try {
      const res = await fetch(`${base}/address/${encodeURIComponent(address)}/txs`);
      txs = await res.json();
    } catch (e) {
      logger.warn("btc address txs failed", { address, err: String(e) });
      continue;
    }

    for (const tx of txs) {
      let received = 0n;
      for (const o of tx.vout ?? []) {
        if (o.scriptpubkey_address === address && o.value != null) {
          received += BigInt(o.value);
        }
      }
      if (received <= 0n) continue;

      const bh = tx.status?.block_height;
      const confirmations =
        tx.status?.confirmed && bh != null ? Math.max(0, tip - bh + 1) : 0;

      await upsertIncomingTransaction({
        walletId,
        txHash: tx.txid,
        fromAddress: "",
        toAddress: address,
        amount: received.toString(),
        tokenSymbol: nativeSymbolForChain(chain),
        tokenDecimals: nativeDecimalsForChain(chain),
        chain,
        confirmations,
        blockNumber: bh != null ? BigInt(bh) : null,
        logIndex: -1,
      });
    }
  }
}
