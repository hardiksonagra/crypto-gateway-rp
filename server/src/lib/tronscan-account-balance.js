import { utils as tronUtils } from "tronweb";
import { re } from "../config/runtime-env.js";
import { logger } from "./logger.js";
import { acquireOutboundRpcSlot } from "./network-rpc-rate-limit.js";
import {
  getTronscanFetchHeaders,
  tronscanApiHostnameForLog,
} from "./tron-node-client.js";

/**
 * @param {string} addr
 * @returns {string}
 */
function toHexKey(addr) {
  const s = String(addr ?? "").trim();
  if (!s) return "";
  try {
    return tronUtils.address.toHex(s).toLowerCase();
  } catch {
    return s.toLowerCase();
  }
}

/**
 * @param {unknown} raw
 * @returns {bigint}
 */
function balanceFieldToBigInt(raw) {
  if (raw === undefined || raw === null) return 0n;
  if (typeof raw === "bigint") return raw >= 0n ? raw : 0n;
  if (typeof raw === "number" && Number.isFinite(raw)) return BigInt(Math.trunc(raw));
  const s = String(raw).trim();
  if (!s || s === "0") return 0n;
  if (/^\d+$/.test(s)) return BigInt(s);
  const f = Number(s);
  if (Number.isFinite(f)) return BigInt(Math.trunc(f));
  return 0n;
}

/**
 * TronScan account document (TRX sun + optional `trc20token_balances`).
 *
 * @param {string} address Base58 account address
 * @returns {Promise<Record<string, unknown>>}
 */
async function fetchTronscanAccountWithTokens(address) {
  if (!re.tronscanApiKey?.trim()) {
    const err = new Error(
      "TRONSCAN_API_KEY_REQUIRED — set TRONSCAN_API_KEY (.env or Admin → System settings)",
    );
    /** @type {Error & { code?: string }} */
    const e = err;
    e.code = "TRONSCAN_API_KEY_REQUIRED";
    throw e;
  }
  const base = re.tronscanApiBase.replace(/\/$/, "");
  const url = `${base}/api/account?address=${encodeURIComponent(address.trim())}&includeToken=true`;
  await acquireOutboundRpcSlot("TRON");
  const res = await fetch(url, { headers: getTronscanFetchHeaders() });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    logger.error("tronscan_balance_account_non_json", {
      event: "tronscan_balance_account_non_json",
      address: address.slice(0, 14),
      httpStatus: res.status,
      tronscan_host: tronscanApiHostnameForLog(),
      body_preview: text.slice(0, 400),
    });
    throw new Error("tronscan_account_invalid_json");
  }
  if (!res.ok) {
    logger.error("tronscan_balance_account_http_error", {
      event: "tronscan_balance_account_http_error",
      address: address.slice(0, 14),
      httpStatus: res.status,
      tronscan_host: tronscanApiHostnameForLog(),
      body_preview: text.slice(0, 400),
    });
    throw new Error(`tronscan_account_http_${res.status}`);
  }
  return data && typeof data === "object"
    ? /** @type {Record<string, unknown>} */ (data)
    : {};
}

/**
 * Native TRX balance in sun from TronScan `/api/account` JSON.
 *
 * @param {Record<string, unknown>} data
 * @returns {bigint}
 */
export function trxSunFromTronscanAccount(data) {
  return balanceFieldToBigInt(data?.balance);
}

/**
 * USDT TRC20 balance in smallest units for the configured contract row.
 *
 * @param {Record<string, unknown>} data
 * @param {string} usdtContractBase58
 * @returns {bigint}
 */
export function usdtAtomicFromTronscanAccount(data, usdtContractBase58) {
  const want = toHexKey(usdtContractBase58);
  const list = data?.trc20token_balances;
  if (!Array.isArray(list) || !want) return 0n;
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const r = /** @type {Record<string, unknown>} */ (row);
    const tid =
      r.tokenId ?? r.token_id ?? r.contractAddress ?? r.contract_address;
    if (toHexKey(String(tid ?? "")) !== want) continue;
    const decimals = Number(r.tokenDecimal ?? r.token_decimals ?? r.decimals ?? 6) || 6;
    const rawBal = r.balance ?? r.balance_str ?? r.quant ?? r.tokenBalance;
    let atomic = balanceFieldToBigInt(rawBal);
    if (atomic === 0n && rawBal != null) {
      const fs = String(rawBal).trim();
      if (fs.includes(".")) {
        const n = Number(fs);
        if (Number.isFinite(n) && n >= 0) {
          atomic = BigInt(Math.round(n * 10 ** decimals));
        }
      }
    }
    return atomic;
  }
  return 0n;
}

/**
 * Admin wallet balance refresh: TRX (sun) or USDT (atomic) via TronScan HTTP API.
 *
 * @param {string} address
 * @param {"TRX" | "USDT"} kind
 * @param {string} [usdtContractBase58] Required when kind is USDT
 * @returns {Promise<bigint>}
 */
export async function readTronBalanceAtomicViaTronscan(address, kind, usdtContractBase58) {
  const data = await fetchTronscanAccountWithTokens(address);
  if (kind === "TRX") return trxSunFromTronscanAccount(data);
  if (kind === "USDT") {
    if (!usdtContractBase58?.trim()) throw new Error("USDT_CONTRACT_REQUIRED");
    return usdtAtomicFromTronscanAccount(data, usdtContractBase58);
  }
  throw new Error("UNSUPPORTED_TRON_BALANCE_KIND");
}
