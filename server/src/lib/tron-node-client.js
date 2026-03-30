import { TronWeb } from "tronweb";
import { re } from "../config/runtime-env.js";
import { logger } from "./logger.js";

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
 */
export function getTronscanFetchHeaders() {
  const h = { "Content-Type": "application/json" };
  if (re.tronscanApiKey?.trim()) {
    h["TRON-PRO-API-KEY"] = re.tronscanApiKey.trim();
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
 * Call immediately before any TronScan HTTP request that loads transfer / history for an address.
 * @param {{ address: string, kind: string }} opts kind e.g. `TRX_TRANSFER` | `TRC20_USDT_TRANSFER`
 */
export function logTronscanAddressHistoryRequest(opts) {
  const address = String(opts.address ?? "").trim();
  const kind = String(opts.kind ?? "unknown");
  const msg = address
    ? `TronScan address history fetch: ${address} (${kind})`
    : `TronScan address history fetch (${kind})`;
  /** Single object so production JSON + dev printf always include `message` and `address`. */
  logger.log({
    level: "info",
    message: msg,
    event: "tronscan_address_history_request",
    address: address || null,
    kind,
    tronscan_host: tronscanApiHostnameForLog(),
  });
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
