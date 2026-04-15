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

/** @type {Map<"erc20" | "trc20", Promise<void>>} */
const depositScannerTailByRail = new Map();
/** @type {Map<"erc20" | "trc20", number[]>} */
const depositScannerStampsByRail = new Map();

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
 *
 * @param {"erc20" | "trc20"} rail
 */
export async function acquireDepositScannerApiSlot(rail) {
  const max = effectiveDepositScannerMaxPerSecond(rail);
  if (max <= 0) return;

  async function waitForDepositScannerSlot() {
    while (true) {
      const now = Date.now();
      let stamps = depositScannerStampsByRail.get(rail) ?? [];
      stamps = stamps.filter((t) => now - t < 1000);
      if (stamps.length < max) {
        stamps.push(now);
        depositScannerStampsByRail.set(rail, stamps);
        return;
      }
      const waitMs = 1000 - (now - stamps[0]) + 1;
      await new Promise((r) => setTimeout(r, Math.max(1, waitMs)));
    }
  }

  const prev = depositScannerTailByRail.get(rail) ?? Promise.resolve();
  const done = prev.then(() => waitForDepositScannerSlot());
  depositScannerTailByRail.set(
    rail,
    done.then(
      () => {},
      () => {},
    ),
  );
  await done;
}

/**
 * @param {import("@prisma/client").Chain} chain
 * @returns {RpcBudgetKey}
 */
export function evmRpcBudgetKey(chain) {
  return `EVM_${chain}`;
}
