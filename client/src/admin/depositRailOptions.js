/**
 * Gateway rails: USDT·TRC20 + USDT·ERC20 only (mirrors server `GATEWAY_RAILS`).
 */
export const ALL_DEPOSIT_RAIL_OPTIONS = [
  { key: "USDT|TRC20", label: "USDT — TRC20 (TRON)", chain: "TRON" },
  { key: "USDT|ERC20", label: "USDT — ERC20 (Ethereum)", chain: "ETH" },
];

/** Client-only default; real value comes from API (`gateway_tron_usdt_only` / Admin System settings). */
export const GATEWAY_TRON_USDT_ONLY = false;

export const DEPOSIT_RAIL_OPTIONS = ALL_DEPOSIT_RAIL_OPTIONS;
export const DEPOSIT_RAIL_KEYS = DEPOSIT_RAIL_OPTIONS.map((o) => o.key);

/** Chains allowed in merchant Settings / admin merchant forms for default_chains. */
export const MERCHANT_SETTINGS_CHAIN_VALUES = ["TRON", "ETH"];

/** Gateway product chains (mirrors server). */
export const MERCHANT_PRODUCT_CHAIN_CODES = ["TRON", "ETH"];

/**
 * @param {string[] | undefined} chains Selected default chains
 * @param {string[] | undefined} [platformChains] If set, only rails on these platform-enabled chains (admin Supported chains).
 * @param {boolean} [useFullProductCatalog] Admin merchant forms: use full rail list (same as product here).
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
