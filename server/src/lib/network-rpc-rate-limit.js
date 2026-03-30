import { re } from "../config/runtime-env.js";

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
 * @param {import("@prisma/client").Chain} chain
 * @returns {RpcBudgetKey}
 */
export function evmRpcBudgetKey(chain) {
  return `EVM_${chain}`;
}
