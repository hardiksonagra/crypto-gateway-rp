import { Chain } from "@prisma/client";

const CHAINS = new Set(Object.values(Chain));

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
  return { chains: uniq };
}
