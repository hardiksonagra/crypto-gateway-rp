import { env } from "../config/env.js";
import {
  depositRailKey,
  normalizeAssetPart,
  parseDepositRailKeyString,
  resolveDepositRail,
  suggestedDefaultPairForChain,
} from "../config/payment-rails.js";

/**
 * @param {unknown} raw
 * @param {import("@prisma/client").Chain[]} defaultChains
 * @returns {{ keys: string[] } | { error: string }}
 */
export function parseSupportedDepositRailsInput(raw, defaultChains) {
  if (!Array.isArray(raw)) {
    return { error: "supported_deposit_rails must be an array" };
  }
  if (raw.length === 0) {
    return { error: "supported_deposit_rails must include at least one rail" };
  }
  let list = raw.map((x) => String(x ?? "").trim()).filter(Boolean);
  if (env.gatewayTronUsdtOnly) {
    list = list.filter((item) => {
      const { currency, network } = parseDepositRailKeyString(item);
      return currency === "USDT" && network === "TRC20";
    });
    if (list.length === 0) {
      list = ["USDT|TRC20"];
    }
  }
  const keys = [];
  const seen = new Set();
  for (const item of list) {
    const { currency, network } = parseDepositRailKeyString(String(item ?? ""));
    const rail = resolveDepositRail(currency, network);
    if (!rail) {
      return { error: "invalid currency / network in supported_deposit_rails" };
    }
    if (!defaultChains.includes(rail.chain)) {
      return { error: "each supported rail must use a chain listed in default_chains" };
    }
    const k = depositRailKey(rail.currency, rail.network);
    if (!seen.has(k)) {
      seen.add(k);
      keys.push(k);
    }
  }
  return { keys };
}

/**
 * @param {{ default_currency?: string, default_network?: string }} body
 * @param {import("@prisma/client").Chain[]} defaultChains
 * @param {string[] | null | undefined} constraintKeys
 * @returns {{ currency: string, network: string } | { error: string }}
 */
export function pickMerchantDefaultPair(body, defaultChains, constraintKeys) {
  const first = defaultChains[0];
  if (!first) {
    return { error: "default_chains must include at least one chain" };
  }
  const sug = suggestedDefaultPairForChain(first);
  let c = normalizeAssetPart(body.default_currency);
  let n = normalizeAssetPart(body.default_network);
  if (constraintKeys && constraintKeys.length > 0) {
    const railFirst = parseDepositRailKeyString(constraintKeys[0]);
    if (!c) c = railFirst.currency;
    if (!n) n = railFirst.network;
  } else {
    if (!c) c = sug.currency;
    if (!n) n = sug.network;
  }
  const rail = resolveDepositRail(c, n);
  if (!rail)
    return { error: "invalid default_currency / default_network pair" };
  if (!defaultChains.includes(rail.chain)) {
    return { error: "default pair must use a chain listed in default_chains" };
  }
  if (constraintKeys && constraintKeys.length > 0) {
    const k = depositRailKey(rail.currency, rail.network);
    if (!constraintKeys.includes(k)) {
      return {
        error: "default_currency / default_network must be one of supported_deposit_rails",
      };
    }
  }
  return { currency: rail.currency, network: rail.network };
}
