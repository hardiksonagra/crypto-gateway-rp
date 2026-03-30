import { depositRailKey, normalizeAssetPart } from "../../config/payment-rails.js";
import { re } from "../../config/runtime-env.js";
import { logger } from "../../lib/logger.js";

/** Product rails shown first in tick logs (matches gateway USDT/TRX rails). */
export const WORKER_RAIL_LOG_ORDER = [
  "USDT|TRC20",
  "USDT|SPL",
  "USDT|ERC20",
  "USDT|BEP20",
  "USDT|TON",
  "TRX|TRON",
];

/** Human-readable rail labels for console / log lines. */
const RAIL_LABEL = {
  "USDT|TRC20": "USDT TRC20",
  "USDT|SPL": "USDT SPL (Solana)",
  "USDT|ERC20": "USDT ERC20",
  "USDT|BEP20": "USDT BEP20",
  "USDT|TON": "USDT TON",
  "TRX|TRON": "TRX TRON",
};

/** Max addresses inlined per chain in the log `message` (full list stays in `polled_addresses_by_chain`). */
const POLL_ADDR_INLINE_PER_CHAIN = 25;

/**
 * @param {number} total
 * @param {Record<string, number>} rails
 * @param {number} other
 * @param {Record<string, string[]>} polledByChain
 */
function formatDepositScanLogMessage(total, rails, other, polledByChain) {
  const head =
    total === 0
      ? "Deposit scan — no new transaction rows (chains checked, nothing to insert)."
      : `Deposit scan — ${total} new transaction row(s) inserted.`;
  const lines = WORKER_RAIL_LOG_ORDER.map(
    (key) => `  · ${RAIL_LABEL[key] ?? key}: ${rails[key] ?? 0}`,
  );
  const tail =
    other > 0 ? `\n  · other rails (new rows): ${other}` : "";
  const chainKeys = Object.keys(polledByChain).sort();
  let addrSection;
  if (chainKeys.length === 0) {
    addrSection =
      "\nPolled for incoming tx: (no wallet addresses — scanners skipped or no live wallets in scope).";
  } else {
    const parts = [];
    let grandTotal = 0;
    for (const ck of chainKeys) {
      const addrs = polledByChain[ck];
      grandTotal += addrs.length;
      const shown = addrs.slice(0, POLL_ADDR_INLINE_PER_CHAIN);
      const more = addrs.length - shown.length;
      const suffix = more > 0 ? ` … +${more} more (see polled_addresses_by_chain)` : "";
      parts.push(`  · ${ck} (${addrs.length}): ${shown.join(", ")}${suffix}`);
    }
    addrSection = `\nPolled for incoming tx (${grandTotal} unique address(es) across chains):\n${parts.join("\n")}`;
  }
  return `${head}\nRails:\n${lines.join("\n")}${tail}${addrSection}`;
}

let tickActive = false;
/** @type {Map<string, number>} */
let tickCounts = new Map();
/** @type {Map<string, Set<string>>} chain name -> on-chain addresses we fetched / monitored this tick */
let tickPolledAddresses = new Map();

export function workerRailMetricsEnabled() {
  const m = re.workerLogRailCounts.toLowerCase();
  return m === "nonzero" || m === "always";
}

export function startWorkerDepositScanTick() {
  if (!workerRailMetricsEnabled()) return;
  tickActive = true;
  tickCounts = new Map();
  tickPolledAddresses = new Map();
}

/**
 * Wallets / on-chain addresses included in this tick’s incoming-tx poll (TronScan, TON API, block scan + logs, etc.).
 * @param {string} chain Prisma `Chain` enum value (e.g. TRON, ETH).
 * @param {Iterable<string>} addresses
 */
export function recordDepositScanPolledAddresses(chain, addresses) {
  if (!workerRailMetricsEnabled() || !tickActive) return;
  const ck = String(chain);
  if (!tickPolledAddresses.has(ck)) tickPolledAddresses.set(ck, new Set());
  const set = tickPolledAddresses.get(ck);
  for (const a of addresses) {
    const s = a != null ? String(a).trim() : "";
    if (s) set.add(s);
  }
}

/**
 * One new `transactions` row was inserted (not a confirmation update).
 * @param {string} currency
 * @param {string} network
 */
export function recordNewDepositInsert(currency, network) {
  if (!workerRailMetricsEnabled()) return;
  const key = depositRailKey(
    normalizeAssetPart(currency),
    normalizeAssetPart(network),
  );
  if (tickActive) {
    tickCounts.set(key, (tickCounts.get(key) ?? 0) + 1);
    return;
  }
  logger.info("new_deposit_row_inserted", {
    deposit_rail: key,
    note: "outside_worker_scan_tick (e.g. sandbox simulate-deposit)",
  });
}

export function finishWorkerDepositScanTick() {
  if (!workerRailMetricsEnabled()) return;
  tickActive = false;
  const mode = re.workerLogRailCounts.toLowerCase();

  const rails = {};
  let total = 0;
  for (const k of WORKER_RAIL_LOG_ORDER) {
    const n = tickCounts.get(k) ?? 0;
    rails[k] = n;
    total += n;
  }
  let other = 0;
  for (const [k, n] of tickCounts) {
    if (!WORKER_RAIL_LOG_ORDER.includes(k)) {
      other += n;
      total += n;
    }
  }

  /** @type {Record<string, string[]>} */
  const polledAddressesByChain = {};
  let polledGrandTotal = 0;
  for (const [ck, set] of tickPolledAddresses) {
    if (set.size === 0) continue;
    const sorted = [...set].sort();
    polledAddressesByChain[ck] = sorted;
    polledGrandTotal += sorted.length;
  }
  tickPolledAddresses = new Map();

  const readableMessage = formatDepositScanLogMessage(
    total,
    rails,
    other,
    polledAddressesByChain,
  );
  const payload = {
    message: readableMessage,
    event: "worker_deposit_scan_tick",
    new_row_inserts_by_rail: rails,
    total_new_rows: total,
    polled_addresses_by_chain: polledAddressesByChain,
    polled_address_count: polledGrandTotal,
    ...(other > 0 ? { other_rails_new_rows: other } : {}),
  };

  if (mode === "always") {
    logger.log({ level: "info", ...payload });
    return;
  }
  if (mode === "nonzero" && total > 0) {
    logger.log({ level: "info", ...payload });
  }
}
