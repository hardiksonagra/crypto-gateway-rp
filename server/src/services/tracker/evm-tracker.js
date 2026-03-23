import { ethers } from "ethers";
import { chainToRpcUrl, chainToStaticNetwork, isEvmChain } from "../../config/chains.js";
import { getErc20Contracts } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { nativeDecimalsForChain, nativeSymbolForChain } from "../native-symbols.js";
import {
  advanceScanner,
  getOrInitScannerBlock,
  loadWatchedAddresses,
  normalizeMatchAddress,
  upsertIncomingTransaction,
} from "../payment/transaction-upsert.js";

const transferTopic = ethers.id("Transfer(address,address,uint256)");
const erc20Iface = new ethers.Interface([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

function chainConfigKey(chain) {
  return chain;
}

export async function scanEvmChain(chain) {
  if (!isEvmChain(chain)) return;

  const network = chainToStaticNetwork(chain);
  const provider = new ethers.JsonRpcProvider(chainToRpcUrl(chain), network, {
    staticNetwork: network,
  });
  const tip = BigInt(await provider.getBlockNumber());
  let cursor = await getOrInitScannerBlock(chain, tip);
  if (cursor >= tip) return;

  const watched = await loadWatchedAddresses(chain);
  if (watched.size === 0) {
    await advanceScanner(chain, tip);
    return;
  }

  const rawErc20 = getErc20Contracts()[chainConfigKey(chain)] ?? {};
  const erc20Map = {};
  for (const [addr, meta] of Object.entries(rawErc20)) {
    erc20Map[addr.toLowerCase()] = meta;
  }

  const maxBatch = 8n;
  const end = tip < cursor + maxBatch ? tip : cursor + maxBatch;

  for (let b = cursor + 1n; b <= end; b++) {
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
      const hit = watched.get(to);
      if (!hit) continue;
      const val = tx.value ?? 0n;
      if (val <= 0n) continue;

      await upsertIncomingTransaction({
        walletId: hit.walletId,
        txHash: tx.hash,
        fromAddress: tx.from ?? "",
        toAddress: hit.address,
        amount: val.toString(),
        tokenSymbol: nativeSymbolForChain(chain),
        tokenDecimals: nativeDecimalsForChain(chain),
        chain,
        confirmations: Number(tip - b + 1n),
        blockNumber: b,
        logIndex: -1,
      });
    }

    let logs = [];
    try {
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
      const hit = watched.get(toAddr);
      if (!hit) continue;
      const amount = parsed.args.value;

      await upsertIncomingTransaction({
        walletId: hit.walletId,
        txHash: log.transactionHash,
        fromAddress: String(parsed.args.from),
        toAddress: hit.address,
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
