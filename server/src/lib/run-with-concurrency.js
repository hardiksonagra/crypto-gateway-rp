/**
 * Run `fn` over `items` with at most `concurrency` in-flight executions at a time.
 *
 * @template T
 * @param {readonly T[]} items
 * @param {number} concurrency — minimum 1
 * @param {(item: T, index: number) => Promise<void>} fn
 * @returns {Promise<void>}
 */
export async function runWithConcurrency(items, concurrency, fn) {
  const n = Math.max(1, Math.floor(concurrency));
  if (!items.length) return;
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      await fn(items[i], i);
    }
  }
  const pool = Math.min(n, items.length);
  await Promise.all(Array.from({ length: pool }, () => worker()));
}

/**
 * Same as {@link runWithConcurrency} but collects return values in input order.
 *
 * @template T,R
 * @param {readonly T[]} items
 * @param {number} concurrency — minimum 1
 * @param {(item: T, index: number) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
export async function runWithConcurrencyMap(items, concurrency, fn) {
  const n = Math.max(1, Math.floor(concurrency));
  if (!items.length) return [];
  /** @type {R[]} */
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  const pool = Math.min(n, items.length);
  await Promise.all(Array.from({ length: pool }, () => worker()));
  return results;
}
