import { TronWeb } from "tronweb";
import { re } from "../config/runtime-env.js";

/** TronWeb / wallet sweep base — no `/jsonrpc/` suffix. */
export function getTronFullNodeBase() {
  return re.tronFullNode.replace(/\/$/, "");
}

/** Same headers as read-only TronWeb (TronGrid + many providers accept `TRON-PRO-API-KEY`). */
export function getTronProgApiKeyHeaders() {
  if (!re.tronApiKey?.trim()) return {};
  return { "TRON-PRO-API-KEY": re.tronApiKey.trim() };
}

/**
 * TronScan API (docs.tronscan.org): same header name as TronGrid — `TRON-PRO-API-KEY`.
 *
 * @param {string} [overrideApiKey] — deposit worker pool lease; falls back to runtime env.
 */
export function getTronscanFetchHeaders(overrideApiKey) {
  const h = { "Content-Type": "application/json" };
  const k =
    typeof overrideApiKey === "string" && overrideApiKey.trim()
      ? overrideApiKey.trim()
      : (re.tronscanApiKey?.trim() ?? "");
  if (k) {
    h["TRON-PRO-API-KEY"] = k;
  }
  return h;
}

/** Hostname for TronScan API logs (no path / secrets). */
export function tronscanApiHostnameForLog() {
  try {
    return new URL(re.tronscanApiBase.replace(/\/$/, "")).hostname;
  } catch {
    return "tronscan_base_invalid";
  }
}

/**
 * @returns {import("tronweb").TronWeb}
 */
export function createReadOnlyTronWeb() {
  return new TronWeb({
    fullHost: getTronFullNodeBase(),
    headers: getTronProgApiKeyHeaders(),
  });
}

/** Hostname only for logs (no path token). */
export function tronFullNodeHostnameForLog() {
  try {
    return new URL(getTronFullNodeBase()).hostname;
  } catch {
    return "tron_full_node_invalid";
  }
}
