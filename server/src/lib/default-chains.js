import { Chain } from "@prisma/client";
import { re } from "../config/runtime-env.js";
import { isChainLiveForPlatform } from "./chain-enable.js";

const CHAINS = new Set(Object.values(Chain));

/** Gateway-supported chains for default selection (USDT·TRC20 + USDT·ERC20). */
const PRODUCT_CHAINS = new Set([Chain.TRON, Chain.ETH]);

/**
 * @param {unknown} raw
 * @param {{ minOne: boolean, ignoreGatewayTronUsdtOnly?: boolean }} opts
 * @returns {{ chains: Chain[] } | { error: string }}
 */
export function parseDefaultChainsArray(raw, opts) {
  if (!Array.isArray(raw)) {
    return { error: "default_chains must be an array of chain codes" };
  }
  const uniq = [...new Set(raw.map((x) => String(x ?? "").trim()).filter(Boolean))];
  if (opts.minOne && uniq.length === 0) {
    return { error: "select at least one default chain" };
  }
  if (!uniq.every((c) => CHAINS.has(c))) {
    return { error: "invalid chain in default_chains" };
  }
  if (!uniq.every((c) => PRODUCT_CHAINS.has(c))) {
    return {
      error: "only TRON and ETH are supported (matches gateway rails)",
    };
  }
  for (const c of uniq) {
    if (!isChainLiveForPlatform(re.chainEnabledRecord, c)) {
      return {
        error: `chain ${c} is disabled for this deployment (admin → Supported chains)`,
      };
    }
  }
  return { chains: uniq };
}
