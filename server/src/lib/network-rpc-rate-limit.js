import { re } from "../config/runtime-env.js";

/**
 * When `DEPOSIT_SCANNER_API_MAX_PER_SECOND_ERC20` is unset / 0, Etherscan-style APIs still need a
 * conservative cap — otherwise `eth_blockNumber` + parallel `getLogs` exceed free-tier **3/sec** and
 * return `Max calls per sec rate limit reached`.
 */
const ETHERSCAN_DEPOSIT_SCANNER_DEFAULT_MAX_PER_SEC = 3;

/**
 * Rolling-1s cap used by {@link acquireDepositScannerApiSlot} and ERC20 parallel block count.
 *
 * @param {"erc20" | "trc20"} rail
 * @returns {number} `0` = no deposit-scanner cap for this rail (Tron only; ERC20 uses default above).
 */
export function effectiveDepositScannerMaxPerSecond(rail) {
  const raw =
    rail === "erc20"
      ? re.depositScannerApiMaxPerSecondErc20
      : re.depositScannerApiMaxPerSecondTrc20;
  if (raw > 0) return raw;
  if (rail === "erc20") return ETHERSCAN_DEPOSIT_SCANNER_DEFAULT_MAX_PER_SEC;
  return 0;
}

/**
 * Limits HTTP/RPC calls per upstream “network” (chain/provider bucket) so TronGrid, EVM RPC, etc.
 * stay under provider caps. Waits instead of failing — integrators are unaffected.
 *
 * @typedef {string} RpcBudgetKey e.g. `EVM_ETH`, `TRON`, `BTC`, `TON`
 */

/** @type {Map<RpcBudgetKey, Promise<void>>} */
const tailByKey = new Map();
/** @type {Map<RpcBudgetKey, number[]>} */
const timestampsByKey = new Map();

/** @type {Map<"erc20" | "trc20", number[]>} */
const depositScannerStampsByRail = new Map();
/** @type {Map<"erc20" | "trc20", number>} */
const depositScannerLastGrantMsByRail = new Map();

/**
 * Rolling 1s + minimum spacing between grants (reduces same-ms bursts that TronScan rejects with 429).
 *
 * @param {"erc20" | "trc20"} rail
 */
async function waitForDepositScannerSlot(rail) {
  const max = effectiveDepositScannerMaxPerSecond(rail);
  if (max <= 0) return;
  const minGapMs = Math.max(1, Math.ceil(1000 / max));
  while (true) {
    let now = Date.now();
    let stamps = depositScannerStampsByRail.get(rail) ?? [];
    stamps = stamps.filter((t) => now - t < 1000);
    if (stamps.length >= max) {
      const waitMs = 1000 - (now - stamps[0]) + 1;
      await new Promise((r) => setTimeout(r, Math.max(1, waitMs)));
      continue;
    }
    const lastGrant = depositScannerLastGrantMsByRail.get(rail) ?? 0;
    if (lastGrant > 0 && now - lastGrant < minGapMs) {
      await new Promise((r) =>
        setTimeout(r, minGapMs - (now - lastGrant)),
      );
      continue;
    }
    const stampAt = Date.now();
    stamps.push(stampAt);
    depositScannerStampsByRail.set(rail, stamps);
    depositScannerLastGrantMsByRail.set(rail, stampAt);
    return;
  }
}

/**
 * @param {RpcBudgetKey} key
 */
async function waitForSlot(key) {
  const max = re.outboundRpcMaxPerSecond;
  if (max <= 0) return;

  while (true) {
    const now = Date.now();
    let stamps = timestampsByKey.get(key) ?? [];
    stamps = stamps.filter((t) => now - t < 1000);
    if (stamps.length < max) {
      stamps.push(now);
      timestampsByKey.set(key, stamps);
      return;
    }
    const waitMs = 1000 - (now - stamps[0]) + 1;
    await new Promise((r) => setTimeout(r, Math.max(1, waitMs)));
  }
}

/**
 * Wait until a call to this network’s upstream is allowed (max N per rolling second per key).
 *
 * @param {RpcBudgetKey} key
 * @returns {Promise<void>}
 */
export async function acquireOutboundRpcSlot(key) {
  if (re.outboundRpcMaxPerSecond <= 0) return;
  const prev = tailByKey.get(key) ?? Promise.resolve();
  const done = prev.then(() => waitForSlot(key));
  tailByKey.set(
    key,
    done.then(
      () => {},
      () => {},
    ),
  );
  await done;
}

/**
 * Rolling 1s cap for **deposit scanner** explorer calls only (separate from sweep / other RPC).
 * When the configured max is `0`, this is a no-op (use `acquireOutboundRpcSlot` alone if enabled).
 * Does **not** serialize HTTP — multiple in-flight fetches are allowed up to `parallel` in the
 * worker; this only spaces **starts** (max N per rolling second + min gap). Each PM2 process has its
 * own counters.
 *
 * @param {"erc20" | "trc20"} rail
 */
export async function acquireDepositScannerApiSlot(rail) {
  const max = effectiveDepositScannerMaxPerSecond(rail);
  if (max <= 0) return;
  await waitForDepositScannerSlot(rail);
}

/**
 * @param {import("@prisma/client").Chain} chain
 * @returns {RpcBudgetKey}
 */
export function evmRpcBudgetKey(chain) {
  return `EVM_${chain}`;
}
