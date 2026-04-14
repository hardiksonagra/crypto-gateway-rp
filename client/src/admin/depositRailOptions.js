/**
 * Full gateway rail list (mirrors server `GATEWAY_RAILS`). The exported `DEPOSIT_RAIL_OPTIONS`
 * may be narrowed when `VITE_GATEWAY_TRON_USDT_ONLY` is not `false`/`0` (default: Tron USDT only).
 */
export const ALL_DEPOSIT_RAIL_OPTIONS = [
  { key: "USDT|TRC20", label: "USDT — TRC20 (TRON)", chain: "TRON" },
  { key: "USDT|SPL", label: "USDT — SPL (Solana)", chain: "SOLANA" },
  { key: "USDT|ERC20", label: "USDT — ERC20 (Ethereum)", chain: "ETH" },
  { key: "USDT|TON", label: "USDT — TON", chain: "TON" },
  { key: "USDT|BEP20", label: "USDT — BEP20 (BNB Chain)", chain: "BNB" },
  { key: "TRX|TRON", label: "TRX — TRON (native)", chain: "TRON" },
];

const tronUsdtOnly =
  import.meta.env.VITE_GATEWAY_TRON_USDT_ONLY !== "false" &&
  import.meta.env.VITE_GATEWAY_TRON_USDT_ONLY !== "0";

/** Matches server `GATEWAY_TRON_USDT_ONLY` (see `server/src/config/env.js`). */
export const GATEWAY_TRON_USDT_ONLY = tronUsdtOnly;

export const DEPOSIT_RAIL_OPTIONS = tronUsdtOnly
  ? ALL_DEPOSIT_RAIL_OPTIONS.filter((o) => o.key === "USDT|TRC20")
  : ALL_DEPOSIT_RAIL_OPTIONS;

export const DEPOSIT_RAIL_KEYS = DEPOSIT_RAIL_OPTIONS.map((o) => o.key);

/** Chains allowed in merchant Settings / admin merchant forms for default_chains. */
export const MERCHANT_SETTINGS_CHAIN_VALUES = tronUsdtOnly
  ? ["TRON"]
  : ["TRON", "SOLANA", "ETH", "BNB", "TON"];

/**
 * Gateway product chains (mirrors server `PRODUCT_CHAINS`). **Not** narrowed by VITE — use when intersecting
 * Admin → Supported chains so ETH/ERC20 etc. still appear on admin merchant create/edit when enabled.
 */
export const MERCHANT_PRODUCT_CHAIN_CODES = [
  "TRON",
  "SOLANA",
  "ETH",
  "BNB",
  "TON",
];

/**
 * @param {string[] | undefined} chains Selected default chains
 * @param {string[] | undefined} [platformChains] If set, only rails on these platform-enabled chains (admin Supported chains).
 * @param {boolean} [useFullProductCatalog] Admin merchant forms: use full rail list (USDT ERC20, BEP20, …) even when VITE tron-only narrows the merchant portal.
 * @returns {typeof ALL_DEPOSIT_RAIL_OPTIONS}
 */
export function depositRailsForChains(chains, platformChains, useFullProductCatalog = false) {
  if (!Array.isArray(chains) || chains.length === 0) return [];
  const set = new Set(chains);
  const source = useFullProductCatalog ? ALL_DEPOSIT_RAIL_OPTIONS : DEPOSIT_RAIL_OPTIONS;
  let rails = source.filter((o) => set.has(o.chain));
  if (Array.isArray(platformChains) && platformChains.length > 0) {
    const ps = new Set(platformChains);
    rails = rails.filter((o) => ps.has(o.chain));
  }
  return rails;
}

/**
 * @param {string} currency
 * @param {string} network
 * @returns {string}
 */
export function railKeyFromParts(currency, network) {
  const c = String(currency ?? "")
    .trim()
    .toUpperCase();
  const n = String(network ?? "")
    .trim()
    .toUpperCase();
  const k = `${c}|${n}`;
  if (DEPOSIT_RAIL_KEYS.includes(k)) return k;
  const allKeys = ALL_DEPOSIT_RAIL_OPTIONS.map((o) => o.key);
  if (allKeys.includes(k)) return k;
  return "USDT|TRC20";
}

/**
 * @param {string} key
 * @returns {{ currency: string, network: string }}
 */
export function splitRailKey(key) {
  const [currency = "USDT", network = "TRC20"] = String(key).split("|");
  return { currency, network };
}
