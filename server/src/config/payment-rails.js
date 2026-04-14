import { Chain } from "@prisma/client";
import { re } from "./runtime-env.js";
import { isChainLiveForPlatform } from "../lib/chain-enable.js";
import { nativeSymbolForChain } from "../services/native-symbols.js";

/**
 * @typedef {{ currency: string, network: string, chain: import("@prisma/client").Chain }} PaymentRail
 */

/** Integrator-facing rails (currency + network → underlying chain). */
export const GATEWAY_RAILS = [
  { currency: "USDT", network: "TRC20", chain: Chain.TRON },
  { currency: "USDT", network: "SPL", chain: Chain.SOLANA },
  { currency: "USDT", network: "ERC20", chain: Chain.ETH },
  { currency: "USDT", network: "TON", chain: Chain.TON },
  { currency: "USDT", network: "BEP20", chain: Chain.BNB },
  { currency: "TRX", network: "TRON", chain: Chain.TRON },
];

/**
 * All (currency, network) rows created per underlying chain for scanner_state (EVM shares one block walk).
 * @type {Partial<Record<import("@prisma/client").Chain, Array<{ currency: string, network: string }>>>}
 */
/** Only gateway rails; add chains here + cron tracker + migration when you support more. */
export const SCANNER_STATE_ROWS_BY_CHAIN = {
  [Chain.ETH]: [{ currency: "USDT", network: "ERC20" }],
  [Chain.BNB]: [{ currency: "USDT", network: "BEP20" }],
  [Chain.TRON]: [
    { currency: "USDT", network: "TRC20" },
    { currency: "TRX", network: "TRON" },
  ],
  [Chain.TON]: [{ currency: "USDT", network: "TON" }],
};

/**
 * Gateway + internal portal rails (currency/network → chain).
 * @param {string} currency
 * @param {string} network
 * @returns {PaymentRail | null}
 */
export function resolveDepositRail(currency, network) {
  const c = normalizeAssetPart(currency);
  const n = normalizeAssetPart(network);
  const g = findGatewayRail(c, n);
  if (g) return g;
  for (const ch of Object.keys(SCANNER_STATE_ROWS_BY_CHAIN)) {
    const chain = /** @type {import("@prisma/client").Chain} */ (ch);
    const rows = SCANNER_STATE_ROWS_BY_CHAIN[chain];
    if (!rows) continue;
    for (const r of rows) {
      if (r.currency === c && r.network === n) {
        return { currency: r.currency, network: r.network, chain };
      }
    }
  }
  return null;
}

/**
 * @param {string} s
 * @returns {string}
 */
export function normalizeAssetPart(s) {
  return String(s ?? "")
    .trim()
    .toUpperCase();
}

/**
 * @param {string} currency
 * @param {string} network
 * @returns {PaymentRail | undefined}
 */
export function findGatewayRail(currency, network) {
  const c = normalizeAssetPart(currency);
  const n = normalizeAssetPart(network);
  return GATEWAY_RAILS.find((r) => r.currency === c && r.network === n);
}

/**
 * @param {string} currency
 * @param {string} network
 * @returns {string}
 */
export function depositRailKey(currency, network) {
  return `${normalizeAssetPart(currency)}|${normalizeAssetPart(network)}`;
}

/**
 * @param {string} key
 * @returns {{ currency: string, network: string }}
 */
export function parseDepositRailKeyString(key) {
  const [a = "", b = ""] = String(key ?? "").split("|");
  return { currency: normalizeAssetPart(a), network: normalizeAssetPart(b) };
}

/**
 * @param {import("@prisma/client").Chain} chain
 * @returns {string | undefined}
 */
export function evmNetworkLabelForChain(chain) {
  switch (chain) {
    case Chain.ETH:
      return "ERC20";
    case Chain.BNB:
      return "BEP20";
    case Chain.POLYGON:
      return "POLYGON";
    case Chain.ARBITRUM:
      return "ARBITRUM";
    case Chain.OPTIMISM:
      return "OPTIMISM";
    default:
      return undefined;
  }
}

/**
 * @param {import("@prisma/client").Chain} chain
 * @param {{ currency: string, network: string }} w
 * @returns {boolean}
 */
export function walletAcceptsEvmNative(chain, w) {
  const net = evmNetworkLabelForChain(chain);
  if (!net) return false;
  return w.currency === nativeSymbolForChain(chain) && w.network === net;
}

/**
 * @param {import("@prisma/client").Chain} chain
 * @param {{ currency: string, network: string }} w
 * @param {string} tokenSymbol upper-case
 * @returns {boolean}
 */
export function walletAcceptsEvmErc20(chain, w, tokenSymbol) {
  const net = evmNetworkLabelForChain(chain);
  if (!net) return false;
  return w.currency === tokenSymbol && w.network === net;
}

/**
 * @param {import("@prisma/client").Merchant} merchant
 * @param {PaymentRail} rail
 * @returns {boolean}
 */
export function merchantChainAllowsRail(merchant, rail) {
  if (re.gatewayTronUsdtOnly) {
    if (
      rail.currency !== "USDT" ||
      rail.network !== "TRC20" ||
      rail.chain !== Chain.TRON
    ) {
      return false;
    }
    return true;
  }
  const allowed = merchant.supportedDepositRails ?? [];
  if (allowed.length > 0) {
    const k = depositRailKey(rail.currency, rail.network);
    return allowed.includes(k);
  }
  const chains = merchant.defaultChains ?? [];
  return chains.includes(rail.chain);
}

/**
 * @param {Array<{ currency: string, network: string, chain: Chain }>} pairs
 * @returns {Array<{ currency: string, network: string, chain: Chain }>}
 */
function finalizeMerchantGatewayPairs(pairs) {
  const filtered = pairs.filter((p) =>
    isChainLiveForPlatform(re.chainEnabledRecord, p.chain),
  );
  if (!re.gatewayTronUsdtOnly) return filtered;
  const only = filtered.filter(
    (p) =>
      p.currency === "USDT" &&
      p.network === "TRC20" &&
      p.chain === Chain.TRON,
  );
  if (only.length > 0) return only;
  if (isChainLiveForPlatform(re.chainEnabledRecord, Chain.TRON)) {
    return [{ currency: "USDT", network: "TRC20", chain: Chain.TRON }];
  }
  return [];
}

/**
 * Currency/network pairs this merchant may use on the gateway (order matches portal Settings when `supportedDepositRails` is set).
 * @param {import("@prisma/client").Merchant} merchant
 * @returns {Array<{ currency: string, network: string, chain: Chain }>}
 */
export function listMerchantSupportedCurrencyPairs(merchant) {
  const stored = merchant.supportedDepositRails ?? [];
  const chainFallback =
    Array.isArray(merchant.defaultChains) && merchant.defaultChains.length > 0
      ? merchant.defaultChains
      : [Chain.TRON];

  if (stored.length > 0) {
    const out = [];
    const seen = new Set();
    for (const rawKey of stored) {
      const { currency, network } = parseDepositRailKeyString(rawKey);
      const rail = resolveDepositRail(currency, network);
      if (!rail) continue;
      if (!merchantChainAllowsRail(merchant, rail)) continue;
      const k = depositRailKey(rail.currency, rail.network);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({
        currency: rail.currency,
        network: rail.network,
        chain: rail.chain,
      });
    }
    return finalizeMerchantGatewayPairs(out);
  }

  const out = [];
  const seen = new Set();
  for (const rail of GATEWAY_RAILS) {
    if (!chainFallback.includes(rail.chain)) continue;
    if (!merchantChainAllowsRail(merchant, rail)) continue;
    const k = depositRailKey(rail.currency, rail.network);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({
      currency: rail.currency,
      network: rail.network,
      chain: rail.chain,
    });
  }
  if (out.length > 0) return finalizeMerchantGatewayPairs(out);

  const dc = normalizeAssetPart(merchant.defaultCurrency);
  const dn = normalizeAssetPart(merchant.defaultNetwork);
  const fallbackRail = resolveDepositRail(dc, dn);
  if (fallbackRail) {
    return finalizeMerchantGatewayPairs([
      {
        currency: fallbackRail.currency,
        network: fallbackRail.network,
        chain: fallbackRail.chain,
      },
    ]);
  }
  return finalizeMerchantGatewayPairs([]);
}

/**
 * Suggested default currency/network when only `chain` is known (portal legacy).
 * @param {import("@prisma/client").Chain} chain
 * @returns {{ currency: string, network: string }}
 */
export function suggestedDefaultPairForChain(chain) {
  switch (chain) {
    case Chain.TRON:
      return { currency: "USDT", network: "TRC20" };
    case Chain.ETH:
      return { currency: "USDT", network: "ERC20" };
    case Chain.BNB:
      return { currency: "USDT", network: "BEP20" };
    case Chain.TON:
      return { currency: "USDT", network: "TON" };
    case Chain.SOLANA:
      return { currency: "USDT", network: "SPL" };
    default:
      return { currency: "USDT", network: "TRC20" };
  }
}
