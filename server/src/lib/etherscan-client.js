import { env } from "../config/env.js";
import { re } from "../config/runtime-env.js";
import { acquireOutboundRpcSlot } from "./network-rpc-rate-limit.js";
import {
  peekFirstDepositScannerExplorerPoolCredential,
  recordDepositScannerExplorerSuccessfulRequest,
} from "./deposit-scanner-explorer-key-pool.js";

/** Hostname for Etherscan API logs (no path / API key). Mirrors `tronscanApiHostnameForLog`. */
export function etherscanApiHostnameForLog() {
  try {
    return new URL(re.etherscanApiBase.replace(/\/$/, "")).hostname;
  } catch {
    return "etherscan_base_invalid";
  }
}

/**
 * ERC-20 balance via Etherscan v2 `account` API (no JSON-RPC `eth_call`).
 *
 * @param {{
 *   chainId: number,
 *   tokenContract: string,
 *   walletAddress: string,
 *   budgetKey: string,
 * }} p
 * @returns {Promise<bigint>}
 */
export async function fetchErc20BalanceAtomicViaEtherscan(p) {
  const { chainId, tokenContract, walletAddress, budgetKey } = p;
  const cred = await peekFirstDepositScannerExplorerPoolCredential("erc20");
  const apiKey =
    cred?.apiKey?.trim() || (env.etherscanApiKey?.trim() ?? "");
  if (!apiKey) {
    throw new Error(
      "ETHERSCAN_EXPLORER_POOL_OR_ENV_KEY_REQUIRED — add an active ERC20 key under Admin → Deposit explorer keys, or set ETHERSCAN_API_KEY in .env for balance fallback.",
    );
  }

  const base = re.etherscanApiBase.replace(/\/$/, "");
  await acquireOutboundRpcSlot(budgetKey);
  const u = new URL(base.includes("://") ? base : `https://${base}`);
  u.searchParams.set("chainid", String(chainId));
  u.searchParams.set("module", "account");
  u.searchParams.set("action", "tokenbalance");
  u.searchParams.set("contractaddress", tokenContract.trim());
  u.searchParams.set("address", walletAddress.trim());
  u.searchParams.set("tag", "latest");
  u.searchParams.set("apikey", apiKey);

  const res = await fetch(u.toString(), { method: "GET" });
  if (!res.ok) {
    throw new Error(`etherscan_tokenbalance_http_${res.status}`);
  }
  /** @type {{ status?: string, message?: string, result?: unknown }} */
  const j = await res.json();
  if (String(j.status ?? "") !== "1" || j.result == null) {
    const errPart =
      typeof j.result === "string" ? j.result : JSON.stringify(j.result);
    throw new Error(`etherscan_tokenbalance_${j.message ?? "error"}:${errPart}`);
  }
  const raw = String(j.result).trim();
  if (!/^\d+$/.test(raw)) {
    throw new Error("etherscan_tokenbalance_bad_amount");
  }
  if (cred) {
    void recordDepositScannerExplorerSuccessfulRequest(cred.keyId);
  }
  return BigInt(raw);
}
