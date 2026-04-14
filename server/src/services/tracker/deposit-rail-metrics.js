import { AsyncLocalStorage } from "node:async_hooks";
import { re } from "../../config/runtime-env.js";
import {
  depositRailKey,
  normalizeAssetPart,
} from "../../config/payment-rails.js";

/**
 * Which cron label is collecting address / rail metrics for the current async tick
 * (so EVM + TRON deposit ticks can run in parallel in one process without mixing buffers).
 * @type {AsyncLocalStorage<{ cron: string }>}
 */
const depositScanLogAls = new AsyncLocalStorage();

/**
 * Run a deposit-scan tick body with a stable `cron` in context for `recordDepositScanPolledAddresses` / rail counts.
 *
 * @param {string} cronLabel e.g. `erc20` (deposit rail id, not PM2 app name)
 * @param {() => void | Promise<void>} fn
 * @returns {Promise<void>}
 */
export function withDepositScanLogCron(cronLabel, fn) {
  const label = String(cronLabel || "combined").trim() || "combined";
  return depositScanLogAls.run({ cron: label }, () => Promise.resolve(fn()));
}

/**
 * @typedef {{
 *   addressScanLogRoundActive: boolean,
 *   depositScanRoundStartedAtIso: string | null,
 *   tickScanAddressesOnly: Map<string, Set<string>>,
 *   metricsTickActive: boolean,
 *   tickCounts: Map<string, number>,
 *   tickPolledAddresses: Map<string, Set<string>>,
 * }} DepositScanRoundState
 */

/** @type {Map<string, DepositScanRoundState>} */
const roundByCron = new Map();

/** @param {string} cron */
function getRound(cron) {
  return roundByCron.get(cron);
}

/** @param {string} cron */
function ensureRound(cron) {
  let r = roundByCron.get(cron);
  if (!r) {
    r = {
      addressScanLogRoundActive: false,
      depositScanRoundStartedAtIso: null,
      tickScanAddressesOnly: new Map(),
      metricsTickActive: false,
      tickCounts: new Map(),
      tickPolledAddresses: new Map(),
    };
    roundByCron.set(cron, r);
  }
  return r;
}

/**
 * Start of each worker deposit-scan pass: reset address-only log buffer (runs every tick).
 *
 * @param {string} [cronLabel] Deposit rail id (e.g. `erc20`, `trc20`, `combined`).
 */
export function beginDepositScanAddressRound(cronLabel = "combined") {
  const key = String(cronLabel || "combined").trim() || "combined";
  const r = ensureRound(key);
  r.addressScanLogRoundActive = true;
  r.depositScanRoundStartedAtIso = new Date().toISOString();
  r.tickScanAddressesOnly = new Map();
}

/**
 * End of deposit-scan pass: clears per-rail address buffer (no console line — use `TRC20:` / `ERC20:` explorer logs).
 *
 * @param {number | null} [_tickDurationMs] Reserved for future metrics; unused.
 * @param {string} [cronLabel] Must match `beginDepositScanAddressRound` for this tick.
 */
export function finishDepositScanAddressRound(_tickDurationMs = null, cronLabel) {
  const key =
    (typeof cronLabel === "string" && String(cronLabel).trim()
      ? String(cronLabel).trim()
      : depositScanLogAls.getStore()?.cron) || "combined";
  const r = getRound(key);
  if (!r?.addressScanLogRoundActive) return;
  r.addressScanLogRoundActive = false;
  r.depositScanRoundStartedAtIso = null;
  r.tickScanAddressesOnly = new Map();
  roundByCron.delete(key);
}

export function workerRailMetricsEnabled() {
  const m = re.workerLogRailCounts.toLowerCase();
  return m === "nonzero" || m === "always";
}

export function startWorkerDepositScanTick() {
  if (!workerRailMetricsEnabled()) return;
  const ctx = depositScanLogAls.getStore();
  const cron = ctx?.cron;
  if (!cron) return;
  const r = ensureRound(cron);
  r.metricsTickActive = true;
  r.tickCounts = new Map();
  r.tickPolledAddresses = new Map();
}

/**
 * Wallets / on-chain addresses included in this tick’s incoming-tx poll.
 * @param {string} chain Prisma `Chain` enum value (e.g. TRON, ETH).
 * @param {Iterable<string>} addresses
 */
export function recordDepositScanPolledAddresses(chain, addresses) {
  const ctx = depositScanLogAls.getStore();
  const cron = ctx?.cron;
  if (!cron) return;
  const r = getRound(cron);
  if (!r) return;

  const ck = String(chain);
  if (workerRailMetricsEnabled() && r.metricsTickActive) {
    if (!r.tickPolledAddresses.has(ck))
      r.tickPolledAddresses.set(ck, new Set());
    const set = r.tickPolledAddresses.get(ck);
    for (const a of addresses) {
      const s = a != null ? String(a).trim() : "";
      if (s) set.add(s);
    }
  }
  if (r.addressScanLogRoundActive) {
    if (!r.tickScanAddressesOnly.has(ck))
      r.tickScanAddressesOnly.set(ck, new Set());
    const setOnly = r.tickScanAddressesOnly.get(ck);
    for (const a of addresses) {
      const s = a != null ? String(a).trim() : "";
      if (s) setOnly.add(s);
    }
  }
}

/**
 * One new `transactions` row was inserted (not a confirmation update).
 * @param {string} currency
 * @param {string} network
 */
export function recordNewDepositInsert(currency, network) {
  if (!workerRailMetricsEnabled()) return;
  const ctx = depositScanLogAls.getStore();
  const cron = ctx?.cron;
  if (!cron) return;
  const r = getRound(cron);
  if (!r?.metricsTickActive) return;
  const key = depositRailKey(
    normalizeAssetPart(currency),
    normalizeAssetPart(network),
  );
  r.tickCounts.set(key, (r.tickCounts.get(key) ?? 0) + 1);
}

export function finishWorkerDepositScanTick() {
  if (!workerRailMetricsEnabled()) return;
  const ctx = depositScanLogAls.getStore();
  const cron = ctx?.cron;
  if (!cron) return;
  const r = getRound(cron);
  if (!r) return;
  r.metricsTickActive = false;
  r.tickCounts = new Map();
  r.tickPolledAddresses = new Map();
}
