import { DepositScannerExplorerRail } from "@prisma/client";
import { prisma } from "./prisma.js";
import {
  decryptMerchantApiKey,
  encryptMerchantApiKey,
} from "./merchant-api-key-cipher.js";
import { logger } from "./logger.js";

/** @typedef {"erc20" | "trc20"} ExplorerPoolRail */

/** @type {Map<number, number[]>} */
const secondStampsByKeyId = new Map();

let cacheInvalidateNonce = 0;
let lastCacheNonce = -1;
/** @type {{ erc20: number; trc20: number }} */
let cachedCounts = { erc20: -1, trc20: -1 };

/**
 * Call after admin mutates explorer key rows so workers pick up changes quickly.
 */
export function invalidateDepositScannerExplorerKeyCache() {
  cacheInvalidateNonce += 1;
}

/**
 * @param {ExplorerPoolRail} rail
 * @returns {import("@prisma/client").DepositScannerExplorerRail}
 */
function prismaRail(rail) {
  const r = String(rail ?? "").trim().toLowerCase();
  const v = DepositScannerExplorerRail[r];
  if (v == null) {
    throw new Error(`unknown_deposit_scanner_explorer_rail:${rail}`);
  }
  return v;
}

/**
 * UTC calendar date at midnight (JS Date).
 */
export function utcTodayMidnight() {
  const d = new Date();
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

/**
 * @param {Date} usageDayUtc
 * @param {Date} todayUtc
 */
function sameUtcCalendarDay(usageDayUtc, todayUtc) {
  return (
    usageDayUtc.getUTCFullYear() === todayUtc.getUTCFullYear() &&
    usageDayUtc.getUTCMonth() === todayUtc.getUTCMonth() &&
    usageDayUtc.getUTCDate() === todayUtc.getUTCDate()
  );
}

/**
 * Successful requests counted for `usage_day_utc` (UTC); rolls forward at UTC midnight.
 *
 * @param {{
 *   usageDayUtc: Date,
 *   requestsToday: number,
 *   maxRequestsPerDay: number,
 * }} row
 * @param {Date} todayUtc
 */
export function effectiveRequestsTodayForUtc(row, todayUtc) {
  if (sameUtcCalendarDay(row.usageDayUtc, todayUtc)) {
    return row.requestsToday;
  }
  return 0;
}

/**
 * @param {ExplorerPoolRail} rail
 */
export async function countActiveDepositScannerExplorerKeys(rail) {
  return prisma.depositScannerExplorerApiKey.count({
    where: { rail: prismaRail(rail), isActive: true },
  });
}

/**
 * @param {ExplorerPoolRail} rail
 */
export async function hasActiveDepositScannerExplorerPool(rail) {
  if (lastCacheNonce !== cacheInvalidateNonce) {
    cachedCounts = {
      erc20: await countActiveDepositScannerExplorerKeys("erc20"),
      trc20: await countActiveDepositScannerExplorerKeys("trc20"),
    };
    lastCacheNonce = cacheInvalidateNonce;
  }
  return (rail === "erc20" ? cachedCounts.erc20 : cachedCounts.trc20) > 0;
}

/**
 * Sum of per-key `max_requests_per_second` for active keys (deposit scan parallelism budget).
 *
 * @param {ExplorerPoolRail} rail
 */
export async function sumMaxRequestsPerSecondForPool(rail) {
  const agg = await prisma.depositScannerExplorerApiKey.aggregate({
    where: { rail: prismaRail(rail), isActive: true },
    _sum: { maxRequestsPerSecond: true },
  });
  const n = agg._sum.maxRequestsPerSecond;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/**
 * Active keys with decryptable plaintext and remaining UTC-day quota (`used < max_requests_per_day`),
 * in **Admin sort order** (`sort_order`, then `id`). No “largest remaining first” shuffle — that caused
 * ping-pong usage across keys while both were far under the daily cap.
 *
 * @param {ExplorerPoolRail} rail
 * @returns {Promise<{ keyId: number, apiKey: string, maxRequestsPerSecond: number }[]>}
 */
async function listPoolCredentialsWithDailyBudgetOrdered(rail) {
  const todayUtc = utcTodayMidnight();
  const rows = await prisma.depositScannerExplorerApiKey.findMany({
    where: { rail: prismaRail(rail), isActive: true },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: {
      id: true,
      apiKeyCipher: true,
      maxRequestsPerDay: true,
      maxRequestsPerSecond: true,
      requestsToday: true,
      usageDayUtc: true,
    },
  });

  /** @type {{ keyId: number, apiKey: string, maxRequestsPerSecond: number }[]} */
  const out = [];
  for (const row of rows) {
    const used = effectiveRequestsTodayForUtc(row, todayUtc);
    if (used >= row.maxRequestsPerDay) {
      continue;
    }
    let apiKey;
    try {
      apiKey = decryptMerchantApiKey(row.apiKeyCipher).trim();
    } catch {
      continue;
    }
    if (!apiKey) {
      continue;
    }
    out.push({
      keyId: row.id,
      apiKey,
      maxRequestsPerSecond: row.maxRequestsPerSecond,
    });
  }
  return out;
}

/**
 * Primary pool credential: lowest `sort_order` / `id` among keys still under the UTC-day cap (same
 * ordering as {@link acquireDepositScannerExplorerApiLease}). No per-second throttle here.
 * After a successful explorer HTTP + valid body, call {@link recordDepositScannerExplorerSuccessfulRequest}.
 *
 * @param {ExplorerPoolRail} rail
 * @returns {Promise<{ keyId: number, apiKey: string } | null>}
 */
export async function peekFirstDepositScannerExplorerPoolCredential(rail) {
  const list = await listPoolCredentialsWithDailyBudgetOrdered(rail);
  const first = list[0];
  return first ? { keyId: first.keyId, apiKey: first.apiKey } : null;
}

/**
 * @param {number} keyId
 * @param {number} maxPerSecond
 */
function tryTakePerSecondSlot(keyId, maxPerSecond) {
  const cap = Math.max(1, maxPerSecond);
  const now = Date.now();
  let stamps = secondStampsByKeyId.get(keyId) ?? [];
  stamps = stamps.filter((t) => now - t < 1000);
  if (stamps.length >= cap) {
    secondStampsByKeyId.set(keyId, stamps);
    return false;
  }
  stamps.push(now);
  secondStampsByKeyId.set(keyId, stamps);
  return true;
}

/**
 * Blocks until the **primary** pool key (lowest `sort_order`, then `id` among rows still under the
 * daily cap) has a per-second slot. Does not “spill” to the next key when the primary is only
 * per-second saturated — that key stays primary until its UTC-day cap is reached (then it drops
 * out of the list and the next sort-ordered key becomes primary).
 *
 * @param {ExplorerPoolRail} rail
 * @returns {Promise<{ keyId: number, apiKey: string }>}
 */
export async function acquireDepositScannerExplorerApiLease(rail) {
  const started = Date.now();
  const maxWaitMs = 120_000;
  const pollSleep = (ms) => new Promise((r) => setTimeout(r, ms));

  while (Date.now() - started < maxWaitMs) {
    const list = await listPoolCredentialsWithDailyBudgetOrdered(rail);
    if (list.length === 0) {
      await pollSleep(25);
      continue;
    }
    const primary = list[0];
    if (tryTakePerSecondSlot(primary.keyId, primary.maxRequestsPerSecond)) {
      return { keyId: primary.keyId, apiKey: primary.apiKey };
    }
    await pollSleep(25);
  }

  throw new Error(`explorer_api_pool_exhausted:${rail}`);
}

/**
 * Count one successful explorer HTTP call (HTTP 2xx + parsed business success) for UTC-day quota.
 *
 * @param {number} keyId
 */
export async function recordDepositScannerExplorerSuccessfulRequest(keyId) {
  try {
    const n = await prisma.$executeRaw`
      UPDATE "deposit_scanner_explorer_api_keys"
      SET
        "requests_today" = CASE
          WHEN "usage_day_utc" < (timezone('utc', now()))::date THEN 1
          ELSE "requests_today" + 1
        END,
        "usage_day_utc" = CASE
          WHEN "usage_day_utc" < (timezone('utc', now()))::date THEN (timezone('utc', now()))::date
          ELSE "usage_day_utc"
        END
      WHERE "id" = ${keyId}
        AND "is_active" = true
        AND (
          "usage_day_utc" < (timezone('utc', now()))::date
          OR "requests_today" < "max_requests_per_day"
        )
    `;
    if (typeof n === "number" && n < 1) {
      logger.warn("explorer_api_pool_success_not_counted", {
        key_id: keyId,
        note: "Daily cap may have been reached concurrently.",
      });
    }
  } catch (e) {
    logger.warn("explorer_api_pool_success_count_failed", {
      key_id: keyId,
      err: String(e),
    });
  }
}
