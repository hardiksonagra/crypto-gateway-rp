import { Chain } from "@prisma/client";
import { JsonRpcProvider } from "ethers";
import { chainToRpcUrl, chainToStaticNetwork } from "../config/chains.js";
import { re } from "../config/runtime-env.js";
import {
  getTronFullNodeBase,
  getTronProgApiKeyHeaders,
} from "../lib/tron-node-client.js";
import { logger } from "../lib/logger.js";
import {
  acquireOutboundRpcSlot,
  evmRpcBudgetKey,
} from "../lib/network-rpc-rate-limit.js";
import { prisma } from "../lib/prisma.js";

/**
 * @param {import("@prisma/client").Chain} chain
 * @param {string} txHash
 * @returns {Promise<{ atomicStr: string, symbol: string } | null>}
 */
async function fetchNetworkFeeFromChain(chain, txHash) {
  const h = String(txHash ?? "").trim();
  if (!h) return null;

  if (chain === Chain.ETH) {
    const rpc = String(re.rpcEth ?? "").trim();
    if (!rpc) return null;
    const hx = h.startsWith("0x") ? h : `0x${h}`;
    try {
      const staticNet = chainToStaticNetwork(Chain.ETH);
      const provider = new JsonRpcProvider(chainToRpcUrl(Chain.ETH), staticNet, {
        staticNetwork: true,
      });
      const budgetKey = evmRpcBudgetKey(Chain.ETH);
      await acquireOutboundRpcSlot(budgetKey);
      const receipt = await provider.getTransactionReceipt(hx);
      if (!receipt) return null;
      const gasUsed = receipt.gasUsed;
      const gasPrice = receipt.gasPrice ?? receipt.effectiveGasPrice ?? 0n;
      if (gasUsed <= 0n || gasPrice <= 0n) return null;
      const feeWei = gasUsed * gasPrice;
      return { atomicStr: feeWei.toString(), symbol: "ETH" };
    } catch (e) {
      logger.warn("payout network fee: ETH receipt fetch failed", {
        tx_hash: hx,
        err: String(e),
      });
      return null;
    }
  }

  if (chain === Chain.TRON) {
    const base = String(re.tronFullNode ?? "").trim();
    if (!base) return null;
    try {
      await acquireOutboundRpcSlot("TRON");
      const url = `${getTronFullNodeBase()}/wallet/gettransactioninfobyid`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getTronProgApiKeyHeaders(),
        },
        body: JSON.stringify({ value: h }),
      });
      if (!res.ok) return null;
      const info = /** @type {{ fee?: number }} */ (await res.json());
      if (!info || typeof info !== "object") return null;
      const rawFee = info.fee;
      let n = 0;
      if (typeof rawFee === "bigint") {
        n = Number(rawFee);
      } else if (typeof rawFee === "string") {
        n = parseInt(rawFee, 10);
      } else if (typeof rawFee === "number") {
        n = rawFee;
      }
      if (!Number.isFinite(n) || n < 0) return null;
      const sun = BigInt(Math.floor(n));
      return { atomicStr: sun.toString(), symbol: "TRX" };
    } catch (e) {
      logger.warn("payout network fee: TRON tx info fetch failed", {
        tx_hash: h,
        err: String(e),
      });
      return null;
    }
  }

  return null;
}

/**
 * Loads fee from RPC and persists when missing. Mutates each row object with new fields so callers can serialize
 * without a second query.
 *
 * @param {import("@prisma/client").Withdrawal[]} rows
 */
export async function fillMissingWithdrawalNetworkFees(rows) {
  const list = Array.isArray(rows) ? rows : [];
  for (const w of list) {
    if (!w?.id || !String(w.txHash ?? "").trim()) continue;
    if (String(w.networkFeeNativeAtomic ?? "").trim()) continue;
    try {
      const fee = await fetchNetworkFeeFromChain(w.chain, String(w.txHash).trim());
      if (!fee) continue;
      const fetchedAt = new Date();
      await prisma.withdrawal.update({
        where: { id: w.id },
        data: {
          networkFeeNativeAtomic: fee.atomicStr,
          networkFeeNativeSymbol: fee.symbol,
          networkFeeFetchedAt: fetchedAt,
        },
      });
      w.networkFeeNativeAtomic = fee.atomicStr;
      w.networkFeeNativeSymbol = fee.symbol;
      w.networkFeeFetchedAt = fetchedAt;
    } catch (e) {
      logger.warn("payout network fee: persist failed", {
        withdrawal_id: w.id,
        err: String(e),
      });
    }
  }
}
