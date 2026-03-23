import { Chain } from "@prisma/client";

const CHAINS = new Set(Object.values(Chain));

/** Gateway-supported L1/L2 list (USDT TRC20 / ERC20 / TON / BEP20 + TRX TRON). */
const PRODUCT_CHAINS = new Set([Chain.TRON, Chain.ETH, Chain.BNB, Chain.TON]);

/**
 * @param {unknown} raw
 * @param {{ minOne: boolean }} opts
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
      error:
        "only TRON, ETH, BNB, TON are supported (matches USDT/TRX gateway rails)",
    };
  }
  return { chains: uniq };
}
