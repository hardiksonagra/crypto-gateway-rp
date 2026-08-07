import { Chain } from "@prisma/client";
import { ethers } from "ethers";
import { utils as tronUtils } from "tronweb";
import {
  parseHumanMinSettlementToAtomic,
  validateAndNormalizeHumanMinSettlement,
} from "./merchant-fee-math.js";

/** @type {readonly string[]} */
export const MERCHANT_PAYOUT_RAIL_KEYS = Object.freeze(["USDT|TRC20", "USDT|ERC20"]);

/**
 * @param {import("@prisma/client").Chain} chain
 * @returns {string | null}
 */
export function payoutRailKeyForChain(chain) {
  if (chain === Chain.TRON) return "USDT|TRC20";
  if (chain === Chain.ETH) return "USDT|ERC20";
  return null;
}

/**
 * Resolved limits/treasury for one payout rail (stored JSON overrides legacy columns).
 *
 * @param {{
 *   payoutMinAmountHuman?: string | null,
 *   payoutMaxAmountHuman?: string | null,
 *   payoutRailsPolicyJson?: unknown,
 *   payoutTreasuryAddressesJson?: unknown,
 * }} merchant
 * @param {string} railKey
 * @returns {{ min: string, max: string, treasury: string }}
 */
export function effectivePayoutPolicyForRail(merchant, railKey) {
  const storedRaw = merchant.payoutRailsPolicyJson;
  const stored =
    storedRaw && typeof storedRaw === "object" && !Array.isArray(storedRaw)
      ? /** @type {Record<string, unknown>} */ (storedRaw)
      : {};
  const rowRaw = stored[railKey];
  const row =
    rowRaw && typeof rowRaw === "object" && !Array.isArray(rowRaw)
      ? /** @type {Record<string, unknown>} */ (rowRaw)
      : {};

  const rowMin = row.min_human != null ? String(row.min_human).trim() : "";
  const rowMax = row.max_human != null ? String(row.max_human).trim() : "";
  const legacyMin = String(merchant.payoutMinAmountHuman ?? "0").trim() || "0";
  const legacyMax = String(merchant.payoutMaxAmountHuman ?? "0").trim() || "0";

  const min = rowMin !== "" ? rowMin : legacyMin;
  const max = rowMax !== "" ? rowMax : legacyMax;

  const rowTreasury =
    row.treasury_address != null ? String(row.treasury_address).trim() : "";
  const ptRaw = merchant.payoutTreasuryAddressesJson;
  const pt =
    ptRaw && typeof ptRaw === "object" && !Array.isArray(ptRaw)
      ? /** @type {Record<string, unknown>} */ (ptRaw)
      : {};
  let treasury = rowTreasury;
  if (!treasury) {
    treasury =
      railKey === "USDT|TRC20"
        ? String(pt.TRON ?? "").trim()
        : railKey === "USDT|ERC20"
          ? String(pt.ETH ?? "").trim()
          : "";
  }

  return { min, max, treasury };
}

/**
 * Portal `auth/me`: merged view for the payout defaults form.
 *
 * @param {{
 *   payoutMinAmountHuman?: string | null,
 *   payoutMaxAmountHuman?: string | null,
 *   payoutRailsPolicyJson?: unknown,
 *   payoutTreasuryAddressesJson?: unknown,
 * }} merchant
 * @returns {Record<string, { min_human: string, max_human: string, treasury_address: string }>}
 */
export function payoutRailsPolicyForMerchantPortal(merchant) {
  /** @type {Record<string, { min_human: string, max_human: string, treasury_address: string }>} */
  const out = {};
  for (const rk of MERCHANT_PAYOUT_RAIL_KEYS) {
    const e = effectivePayoutPolicyForRail(merchant, rk);
    out[rk] = {
      min_human: e.min,
      max_human: e.max,
      treasury_address: e.treasury,
    };
  }
  return out;
}

/**
 * @param {unknown} addr
 * @param {"TRON" | "ETH"} chainKind
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
function validateTreasuryHint(addr, chainKind) {
  const s = addr != null ? String(addr).trim() : "";
  if (!s) return { ok: true, value: "" };
  if (chainKind === "TRON") {
    try {
      tronUtils.address.toHex(s);
      return { ok: true, value: s };
    } catch {
      return { ok: false, error: "invalid_payout_treasury_tron" };
    }
  }
  try {
    return { ok: true, value: ethers.getAddress(s) };
  } catch {
    return { ok: false, error: "invalid_payout_treasury_eth" };
  }
}

/**
 * Normalize merchant PATCH payload `payout_rails_policy` / `payoutRailsPolicy`.
 *
 * @param {unknown} raw
 * @returns {{ ok: true, policy: Record<string, { min_human: string, max_human: string, treasury_address: string }>, treasuryDerived: Record<string, string> } | { ok: false, error: string, message?: string }}
 */
export function normalizePayoutRailsPolicyFromBody(raw) {
  let o = raw;
  if (typeof raw === "string") {
    try {
      o = JSON.parse(raw);
    } catch {
      return { ok: false, error: "payout_rails_policy_invalid_json" };
    }
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) {
    return { ok: false, error: "payout_rails_policy_must_be_object" };
  }

  /** @type {Record<string, { min_human: string, max_human: string, treasury_address: string }>} */
  const policy = {};
  /** @type {Record<string, string>} */
  const treasuryDerived = {};

  for (const rk of MERCHANT_PAYOUT_RAIL_KEYS) {
    const rowRaw = /** @type {Record<string, unknown>} */ (o)[rk];
    const row =
      rowRaw && typeof rowRaw === "object" && !Array.isArray(rowRaw)
        ? /** @type {Record<string, unknown>} */ (rowRaw)
        : {};

    const minNorm = validateAndNormalizeHumanMinSettlement(row.min_human ?? "");
    if (!minNorm.ok) {
      return {
        ok: false,
        error: "invalid_payout_rail_min_amount",
        message: `${rk}: ${minNorm.error}`,
      };
    }
    const maxNorm = validateAndNormalizeHumanMinSettlement(row.max_human ?? "");
    if (!maxNorm.ok) {
      return {
        ok: false,
        error: "invalid_payout_rail_max_amount",
        message: `${rk}: ${maxNorm.error}`,
      };
    }

    const minAt = parseHumanMinSettlementToAtomic(minNorm.raw, 6);
    const maxAt = parseHumanMinSettlementToAtomic(maxNorm.raw, 6);
    if (
      minAt.ok &&
      maxAt.ok &&
      maxAt.value > 0n &&
      minAt.value > 0n &&
      maxAt.value < minAt.value
    ) {
      return {
        ok: false,
        error: "payout_rail_max_below_min",
        message: `Maximum payout must be ≥ minimum for ${rk} (when both are set).`,
      };
    }

    const chainKind = rk === "USDT|TRC20" ? "TRON" : "ETH";
    const tre = validateTreasuryHint(row.treasury_address, chainKind);
    if (!tre.ok) {
      return { ok: false, error: tre.error };
    }

    policy[rk] = {
      min_human: minNorm.raw,
      max_human: maxNorm.raw,
      treasury_address: tre.value,
    };
    if (tre.value) {
      if (rk === "USDT|TRC20") treasuryDerived.TRON = tre.value;
      else treasuryDerived.ETH = tre.value;
    }
  }

  return { ok: true, policy, treasuryDerived };
}
