import { Chain } from "@prisma/client";

/** Admin “Supported chains” toggles — product is USDT·TRC20 + USDT·ERC20 only. */
export const ADMIN_CHAIN_TOGGLE_ORDER = [Chain.ETH, Chain.TRON];

/** @type {Record<string, { label: string, hint: string }>} */
export const CHAIN_ADMIN_META = {
  ETH: { label: "Ethereum", hint: "USDT ERC20 deposits" },
  TRON: { label: "TRON", hint: "USDT TRC20 deposits" },
};

const CHAIN_SET = new Set(Object.values(Chain));

/**
 * @param {unknown} v
 * @returns {boolean}
 */
function coerceBool(v) {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const s = String(v ?? "")
    .trim()
    .toLowerCase();
  if (s === "true" || s === "1" || s === "yes") return true;
  if (s === "false" || s === "0" || s === "no" || s === "") return false;
  return Boolean(v);
}

/**
 * @returns {Record<string, boolean>}
 */
export function buildDefaultChainEnabledMap() {
  return Object.fromEntries(ADMIN_CHAIN_TOGGLE_ORDER.map((c) => [c, true]));
}

/**
 * Parse stored JSON from DB / env. Invalid or empty → {} (meaning “all enabled”).
 *
 * @param {string} raw
 * @returns {Record<string, boolean>}
 */
export function parseChainEnabledRecord(raw) {
  const t = String(raw ?? "").trim();
  if (!t || t === "{}") return {};
  try {
    const p = JSON.parse(t);
    if (!p || typeof p !== "object" || Array.isArray(p)) return {};
    /** @type {Record<string, boolean>} */
    const out = {};
    for (const [k, v] of Object.entries(p)) {
      if (!CHAIN_SET.has(k)) continue;
      out[k] = coerceBool(v);
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Missing key or empty stored object → chain is treated as **enabled** (backward compatible).
 *
 * @param {Record<string, boolean>} record
 * @param {import("@prisma/client").Chain} chain
 * @returns {boolean}
 */
export function isChainLiveForPlatform(record, chain) {
  if (!record || typeof record !== "object") return true;
  if (!Object.prototype.hasOwnProperty.call(record, chain)) return true;
  return record[chain] !== false;
}

/**
 * Merge admin payload into full map and validate at least one chain stays on.
 *
 * @param {unknown} input Flat `{ ETH: true, TRON: false, … }` or nested `{ chains: { … } }`.
 * @returns {string} JSON string for `app_settings.value`
 */
export function serializeChainEnabledFromAdminInput(input) {
  const body =
    input && typeof input === "object" && !Array.isArray(input)
      ? /** @type {Record<string, unknown>} */ (input)
      : {};
  const src =
    body.chains && typeof body.chains === "object" && !Array.isArray(body.chains)
      ? /** @type {Record<string, unknown>} */ (body.chains)
      : body;

  const merged = buildDefaultChainEnabledMap();
  for (const chain of ADMIN_CHAIN_TOGGLE_ORDER) {
    if (Object.prototype.hasOwnProperty.call(src, chain)) {
      merged[chain] = coerceBool(src[chain]);
    }
  }
  const anyOn = ADMIN_CHAIN_TOGGLE_ORDER.some((c) => merged[c] === true);
  if (!anyOn) {
    throw new Error("at least one chain must remain active");
  }
  return JSON.stringify(merged);
}

/**
 * Validate object from JSON.parse before storing (system-settings or sync).
 *
 * @param {Record<string, unknown>} p
 * @returns {string}
 */
export function normalizeChainEnabledStoredObject(p) {
  return serializeChainEnabledFromAdminInput(p);
}

/**
 * Gateway product chains (order = default when repairing merchants after a chain is disabled).
 * Matches client `MERCHANT_PRODUCT_CHAIN_CODES` / server gateway rails scope.
 *
 * @type {readonly import("@prisma/client").Chain[]}
 */
export const MERCHANT_PORTAL_PRODUCT_CHAINS = [Chain.TRON, Chain.ETH];

/**
 * Legacy helper: product chains ∩ platform-on, optionally forced to TRON when `GATEWAY_TRON_USDT_ONLY`.
 * API responses use {@link listMerchantSelectableChainsForAdmin} instead so portal matches Supported chains.
 *
 * @param {Record<string, boolean>} record `re.chainEnabledRecord`
 * @param {boolean} gatewayTronUsdtOnly
 * @returns {string[]}
 */
export function listMerchantSelectableChainsForPortal(record, gatewayTronUsdtOnly) {
  let list = [...MERCHANT_PORTAL_PRODUCT_CHAINS].filter((c) => isChainLiveForPlatform(record, c));
  if (gatewayTronUsdtOnly) {
    list = list.filter((c) => c === Chain.TRON);
  }
  return list.map(String);
}

/**
 * Selectable chains for **admin** merchant forms, **merchant** `GET /auth/me`, and Gateway & webhooks:
 * gateway product list ∩ Supported chains toggles. Does not apply `GATEWAY_TRON_USDT_ONLY`.
 *
 * @param {Record<string, boolean>} record `re.chainEnabledRecord`
 * @returns {string[]}
 */
export function listMerchantSelectableChainsForAdmin(record) {
  return [...MERCHANT_PORTAL_PRODUCT_CHAINS]
    .filter((c) => isChainLiveForPlatform(record, c))
    .map(String);
}
