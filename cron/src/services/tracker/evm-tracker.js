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
import { logger } from "crypto-payment-gateway/src/lib/logger.js";
import {
  acquireOutboundRpcSlot,
  evmRpcBudgetKey,
} from "crypto-payment-gateway/src/lib/network-rpc-rate-limit.js";
import {
  nativeDecimalsForChain,
  nativeSymbolForChain,
} from "crypto-payment-gateway/src/services/native-symbols.js";
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
      for (const w of group) {
        if (!walletAcceptsEvmNative(chain, w)) continue;
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

      for (const w of group) {
        if (!walletAcceptsEvmErc20(chain, w, tokenSym)) continue;
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
    }

    await advanceScanner(chain, b);
  }
}
