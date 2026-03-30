import { Chain } from "@prisma/client";
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

/**
 * @param {{ wallets?: Array<{ id: string, address: string, currency: string, network: string }> }} [options]
 */
export async function scanBtcChain(options = {}) {
  const chain = Chain.BTC;
  const wallets =
    options.wallets ?? (await loadWalletsForChain(chain));
  const targets = wallets.filter((w) => w.currency === "BTC" && w.network === "BTC");
  if (targets.length === 0) return;

  const base = re.btcExplorerApiBase.replace(/\/$/, "");
  let tip = 0;
  try {
    await acquireOutboundRpcSlot("BTC");
    const tipRes = await fetch(`${base}/blocks/tip/height`);
    tip = parseInt(await tipRes.text(), 10);
  } catch (e) {
    logger.warn("btc tip height failed", { err: String(e) });
    return;
  }

  for (const w of targets) {
    const { id: walletId, address } = w;
    let txs = [];
    try {
      await acquireOutboundRpcSlot("BTC");
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
        currency: w.currency,
        network: w.network,
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
