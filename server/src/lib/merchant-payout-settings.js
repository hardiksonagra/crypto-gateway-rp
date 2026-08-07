import { utils as tronUtils } from "tronweb";
import { ethers } from "ethers";

/**
 * @param {unknown} raw
 * @returns {{ ok: true, value: Record<string, string> } | { ok: false, error: string }}
 */
export function normalizePayoutTreasuryAddressesJson(raw) {
  if (raw == null || raw === "") {
    return { ok: true, value: {} };
  }
  let o = raw;
  if (typeof raw === "string") {
    try {
      o = JSON.parse(raw);
    } catch {
      return { ok: false, error: "payout_treasury_addresses_invalid_json" };
    }
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) {
    return { ok: false, error: "payout_treasury_addresses_must_be_object" };
  }
  /** @type {Record<string, string>} */
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    const key = String(k).trim().toUpperCase();
    if (key !== "TRON" && key !== "ETH") continue;
    const s = v != null ? String(v).trim() : "";
    if (!s) continue;
    if (key === "TRON") {
      try {
        tronUtils.address.toHex(s);
      } catch {
        return { ok: false, error: "payout_treasury_tron_invalid" };
      }
      out.TRON = s;
    } else {
      try {
        out.ETH = ethers.getAddress(s);
      } catch {
        return { ok: false, error: "payout_treasury_eth_invalid" };
      }
    }
  }
  return { ok: true, value: out };
}
