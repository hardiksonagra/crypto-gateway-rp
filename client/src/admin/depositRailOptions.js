/** Only gateway rails; extend when server adds more in `GATEWAY_RAILS` / `SCANNER_STATE_ROWS_BY_CHAIN`. */
export const DEPOSIT_RAIL_OPTIONS = [
  { key: "USDT|TRC20", label: "USDT — TRC20 (TRON)", chain: "TRON" },
  { key: "USDT|SPL", label: "USDT — SPL (Solana)", chain: "SOLANA" },
  { key: "USDT|ERC20", label: "USDT — ERC20 (Ethereum)", chain: "ETH" },
  { key: "USDT|TON", label: "USDT — TON", chain: "TON" },
  { key: "USDT|BEP20", label: "USDT — BEP20 (BNB Chain)", chain: "BNB" },
  { key: "TRX|TRON", label: "TRX — TRON (native)", chain: "TRON" },
];

export const DEPOSIT_RAIL_KEYS = DEPOSIT_RAIL_OPTIONS.map((o) => o.key);

/**
 * @param {string[] | undefined} chains
 * @returns {typeof DEPOSIT_RAIL_OPTIONS}
 */
export function depositRailsForChains(chains) {
  if (!Array.isArray(chains) || chains.length === 0) return [];
  const set = new Set(chains);
  return DEPOSIT_RAIL_OPTIONS.filter((o) => set.has(o.chain));
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
