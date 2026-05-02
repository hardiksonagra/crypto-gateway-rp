import { Chain } from "@prisma/client";
import { ethers, parseUnits } from "ethers";
import { utils as tronUtils } from "tronweb";
import { depositRailKey, GATEWAY_RAILS } from "../config/payment-rails.js";
import { prisma } from "./prisma.js";

/** @type {Record<string, "TRON" | "EVM">} */
/** Canonical key for USDT·TRC20 (auto-sweep cron + portal rows). */
export const USDT_TRC20_RAIL_KEY = depositRailKey("USDT", "TRC20");

const RAIL_ADDRESS_FAMILY = Object.fromEntries(
  GATEWAY_RAILS.map((r) => {
    const k = `${String(r.currency).toUpperCase()}|${String(r.network).toUpperCase()}`;
    const fam = r.chain === Chain.TRON ? "TRON" : "EVM";
    return [k, fam];
  }),
);

/**
 * @param {string} railKey
 * @returns {"TRON" | "EVM" | null}
 */
export function chainForDepositRailKey(railKey) {
  return RAIL_ADDRESS_FAMILY[String(railKey ?? "").trim()] ?? null;
}

/**
 * Converts a merchant-entered USDT decimal string (6 dp) to atomic units for TRC20.
 *
 * @param {string | null | undefined} minDec
 * @returns {bigint | null} `0n` if blank; `null` if non‑numeric / invalid for parseUnits.
 */
export function merchantMinDecimalUsdtToAtomic6(minDec) {
  const s = String(minDec ?? "").trim();
  if (!s) return 0n;
  try {
    return parseUnits(s, 6);
  } catch {
    return null;
  }
}

/**
 * @param {string} railKey
 * @param {string} address
 * @returns {{ ok: true, normalized: string } | { ok: false, error: string }}
 */
export function validateTreasuryAddressForRail(railKey, address) {
  const fam = chainForDepositRailKey(railKey);
  if (!fam) {
    return { ok: false, error: "unknown_rail" };
  }
  const a = String(address ?? "").trim();
  if (!a) {
    return { ok: false, error: "address_required" };
  }
  if (fam === "TRON") {
    try {
      tronUtils.address.toHex(a);
      return { ok: true, normalized: a };
    } catch {
      return { ok: false, error: "invalid_tron_address" };
    }
  }
  try {
    return { ok: true, normalized: ethers.getAddress(a) };
  } catch {
    return { ok: false, error: "invalid_evm_address" };
  }
}

/**
 * @param {unknown} raw
 * @returns {{
 *   version: number,
 *   destinations: { rail_key: string, treasury_address: string }[],
 *   min_amounts_by_rail: Record<string, string>,
 * }}
 */
function normalizeStoredJson(raw) {
  const o = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : {};
  const v = Number(o.version);
  const version = Number.isInteger(v) && v >= 1 ? v : 1;
  const dest = o.destinations;
  /** @type {Map<string, { treasury_address: string }>} */
  const map = new Map();
  /** @type {Record<string, string>} */
  const min_amounts_by_rail = {};
  const rawMin = o.min_amounts_by_rail;
  if (rawMin && typeof rawMin === "object" && !Array.isArray(rawMin)) {
    for (const [k, val] of Object.entries(rawMin)) {
      const rk = String(k ?? "").trim();
      if (!rk) continue;
      if (val == null || String(val).trim() === "") continue;
      min_amounts_by_rail[rk] = String(val).trim();
    }
  }
  if (Array.isArray(dest)) {
    for (const row of dest) {
      if (!row || typeof row !== "object") continue;
      const rk = typeof row.rail_key === "string" ? row.rail_key.trim() : "";
      if (!rk) continue;
      const addr =
        typeof row.treasury_address === "string"
          ? row.treasury_address.trim()
          : typeof row.address === "string"
            ? row.address.trim()
            : "";
      map.set(rk, { treasury_address: addr });
      let min = row.min_amount_decimal ?? row.min_amount ?? null;
      if (min != null && String(min).trim() === "") min = null;
      if (min != null) min = String(min).trim();
      if (min && !min_amounts_by_rail[rk]) {
        min_amounts_by_rail[rk] = min;
      }
    }
  }
  const destinations = [...map.entries()].map(([rail_key, x]) => ({
    rail_key,
    treasury_address: x.treasury_address,
  }));
  return { version, destinations, min_amounts_by_rail };
}

/**
 * Merges PATCH payload into existing JSON so partial updates keep other rails.
 *
 * @param {unknown} bodySettings
 * @param {unknown} existingJson
 * @returns {{
 *   version: number,
 *   destinations: { rail_key: string, treasury_address: string }[],
 *   min_amounts_by_rail: Record<string, string>,
 * }}
 */
export function mergeAutoSwapSettingsPayload(bodySettings, existingJson) {
  const existing = normalizeStoredJson(existingJson);
  if (bodySettings === undefined || bodySettings === null) {
    return existing;
  }
  const fromBody = normalizeStoredJson(bodySettings);
  /** @type {Map<string, { rail_key: string; treasury_address: string }>} */
  const map = new Map(
    existing.destinations.map((d) => [
      d.rail_key,
      {
        rail_key: d.rail_key,
        treasury_address: d.treasury_address ?? "",
      },
    ]),
  );
  for (const d of fromBody.destinations) {
    const prev = map.get(d.rail_key) ?? {
      rail_key: d.rail_key,
      treasury_address: "",
    };
    const addr =
      d.treasury_address !== undefined && d.treasury_address !== null
        ? String(d.treasury_address).trim()
        : prev.treasury_address;
    map.set(d.rail_key, {
      rail_key: d.rail_key,
      treasury_address: addr,
    });
  }
  /** @type {Record<string, string>} */
  const minMap = { ...existing.min_amounts_by_rail };
  if (fromBody.min_amounts_by_rail && typeof fromBody.min_amounts_by_rail === "object") {
    for (const [k, val] of Object.entries(fromBody.min_amounts_by_rail)) {
      const rk = String(k ?? "").trim();
      if (!rk) continue;
      if (val == null || String(val).trim() === "") {
        delete minMap[rk];
      } else {
        minMap[rk] = String(val).trim();
      }
    }
  }
  return { version: 2, destinations: [...map.values()], min_amounts_by_rail: minMap };
}

/**
 * @param {{
 *   version: number,
 *   destinations: { rail_key: string, treasury_address: string }[],
 *   min_amounts_by_rail: Record<string, string>,
 * }} settings
 * @param {string[]} supportedRails
 * @param {boolean} enabled
 * @returns {{ ok: true, json: object } | { ok: false, error: string, message?: string, rail_key?: string }}
 */
export function validateMerchantAutoSwapState(settings, supportedRails, enabled) {
  const rails = [...new Set((supportedRails ?? []).map((s) => String(s).trim()).filter(Boolean))];
  const byRail = new Map(settings.destinations.map((d) => [d.rail_key, d]));
  const mins = settings.min_amounts_by_rail && typeof settings.min_amounts_by_rail === "object"
    ? settings.min_amounts_by_rail
    : {};

  for (const rail of rails) {
    if (!chainForDepositRailKey(rail)) {
      return {
        ok: false,
        error: "unknown_rail",
        message: `Unsupported rail key: ${rail}`,
        rail_key: rail,
      };
    }
  }

  for (const rail of rails) {
    const row = byRail.get(rail);
    const addr = row?.treasury_address?.trim() ?? "";
    const minDec = mins[rail] != null ? String(mins[rail]).trim() : "";
    if (minDec !== "") {
      const n = Number(minDec);
      if (!Number.isFinite(n) || n < 0) {
        return {
          ok: false,
          error: "invalid_min_amount",
          message: `Minimum amount for ${rail} must be a non‑negative number or left blank.`,
          rail_key: rail,
        };
      }
    }
    if (addr) {
      const v = validateTreasuryAddressForRail(rail, addr);
      if (!v.ok) {
        return {
          ok: false,
          error: v.error,
          message: `Treasury address for ${rail} is not valid for that network.`,
          rail_key: rail,
        };
      }
    }
  }

  if (enabled) {
    if (rails.length === 0) {
      return {
        ok: false,
        error: "no_deposit_rails",
        message: "Select at least one deposit rail before turning on auto-swap.",
      };
    }
    for (const rail of rails) {
      const row = byRail.get(rail);
      const addr = row?.treasury_address?.trim() ?? "";
      if (!addr) {
        return {
          ok: false,
          error: "treasury_required",
          message: `Auto-swap is on: set a treasury address for every active deposit rail (${rail}).`,
          rail_key: rail,
        };
      }
    }
  }

  const outDest = rails
    .map((rail) => {
      const row = byRail.get(rail);
      const addr = row?.treasury_address?.trim() ?? "";
      if (!addr) return null;
      const v = validateTreasuryAddressForRail(rail, addr);
      if (!v.ok) return null;
      return {
        rail_key: rail,
        treasury_address: v.normalized,
      };
    })
    .filter(Boolean);

  /** @type {Record<string, string>} */
  const outMin = {};
  for (const rail of rails) {
    const minDec = mins[rail] != null ? String(mins[rail]).trim() : "";
    if (minDec !== "") {
      outMin[rail] = minDec;
    }
  }

  return {
    ok: true,
    json: {
      version: 2,
      destinations: /** @type {object[]} */ (outDest),
      min_amounts_by_rail: outMin,
    },
  };
}

/**
 * Resolved plan for workers / swap services — single place to read treasury + minimums.
 *
 * @param {number} merchantId
 * @returns {Promise<
 *   | { enabled: false }
 *   | {
 *       enabled: true,
 *       destinations: { rail_key: string, treasury_address: string }[],
 *       minAmountsByRail: Record<string, string>,
 *     }
 * >}
 */
export async function getMerchantAutoSwapPlan(merchantId) {
  const m = await prisma.merchant.findFirst({
    where: { id: merchantId, deletedAt: null },
    select: {
      autoSwapEnabled: true,
      autoSwapSettingsJson: true,
      supportedDepositRails: true,
    },
  });
  if (!m || !m.autoSwapEnabled) {
    return { enabled: false };
  }
  const normalized = normalizeStoredJson(m.autoSwapSettingsJson);
  const supported = m.supportedDepositRails ?? [];
  const v = validateMerchantAutoSwapState(normalized, supported, true);
  if (!v.ok) {
    return { enabled: false };
  }
  const j = v.json;
  return {
    enabled: true,
    destinations: j.destinations,
    minAmountsByRail:
      j.min_amounts_by_rail && typeof j.min_amounts_by_rail === "object"
        ? /** @type {Record<string, string>} */ (j.min_amounts_by_rail)
        : {},
  };
}
