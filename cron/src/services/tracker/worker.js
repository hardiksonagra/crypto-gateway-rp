import { Chain, MerchantGatewayEnv } from "@prisma/client";
import { SCANNED_EVM_CHAINS } from "crypto-payment-gateway/src/config/chains.js";
import { re } from "crypto-payment-gateway/src/config/runtime-env.js";
import { loadAppSettingsFromDatabase } from "crypto-payment-gateway/src/lib/app-settings-runtime.js";
import { prisma } from "crypto-payment-gateway/src/lib/prisma.js";
import { loadWalletsForChain } from "crypto-payment-gateway/src/services/payment/transaction-upsert.js";
import {
  beginDepositScanAddressRound,
  finishDepositScanAddressRound,
  finishWorkerDepositScanTick,
  startWorkerDepositScanTick,
  withDepositScanLogCron,
} from "crypto-payment-gateway/src/services/tracker/deposit-rail-metrics.js";
import { scanEvmChain } from "./evm-tracker.js";
import { scanTronChain } from "./tron-tracker.js";
import { maybeSweepTick } from "crypto-payment-gateway/src/services/sweep-service.js";
import { retryStuckSuccessCallbacks } from "crypto-payment-gateway/src/services/callback-retry.js";
import { isChainLiveForPlatform } from "crypto-payment-gateway/src/lib/chain-enable.js";

/**
 * Separate chains so a long TRC20 tick (scan + sweep + callbacks) does not stall ERC20 `setInterval` enqueues.
 * Per-cron buffers live in `deposit-rail-metrics` (`withDepositScanLogCron` + `finishDepositScanAddressRound(..., cron)`).
 */
let evmDepositWorkChain = Promise.resolve();
let tronDepositWorkChain = Promise.resolve();

/**
 * @param {() => Promise<void>} fn
 * @returns {Promise<void>}
 */
function enqueueEvmDepositWork(fn) {
  const next = evmDepositWorkChain.then(() => fn());
  evmDepositWorkChain = next.catch(() => {});
  return next;
}

/**
 * @param {() => Promise<void>} fn
 * @returns {Promise<void>}
 */
function enqueueTronDepositWork(fn) {
  const next = tronDepositWorkChain.then(() => fn());
  tronDepositWorkChain = next.catch(() => {});
  return next;
}

let evmTimer = null;
let tronTimer = null;

/** @param {import("@prisma/client").Chain} c */
function chainScanEnabled(c) {
  return isChainLiveForPlatform(re.chainEnabledRecord, c);
}

/**
 * After a successful chain tick, drop one-shot scan flags for live wallets on that chain only.
 * @param {import("@prisma/client").Chain} chain
 */
async function clearDepositSingleTickForChain(chain) {
  await prisma.wallet.updateMany({
    where: {
      chain,
      environment: MerchantGatewayEnv.live,
      depositScanSingleTickRequested: true,
    },
    data: { depositScanSingleTickRequested: false },
  });
}

const EVM_DEPOSIT_CRON = "erc20";

/** USDT·ERC20 (Ethereum) deposit scan only — no sweep / callback retry (those run on the TRC20 worker). */
export async function runEvmDepositTick() {
  return withDepositScanLogCron(EVM_DEPOSIT_CRON, async () => {
    const tickWallStart = Date.now();
    try {
      await loadAppSettingsFromDatabase();
    } catch {
      /* ignore: next tick retries */
    }
    beginDepositScanAddressRound(EVM_DEPOSIT_CRON);
    startWorkerDepositScanTick();
    try {
      for (const chain of SCANNED_EVM_CHAINS) {
        if (!chainScanEnabled(chain)) continue;
        try {
          const w = await loadWalletsForChain(chain);
          if (w.length === 0) continue;
          await scanEvmChain(chain, { wallets: w });
          await clearDepositSingleTickForChain(chain);
        } catch {
          /* ignore */
        }
      }
    } finally {
      finishWorkerDepositScanTick();
      finishDepositScanAddressRound(Date.now() - tickWallStart, EVM_DEPOSIT_CRON);
    }
  });
}

const TRON_DEPOSIT_CRON = "trc20";

/** USDT·TRC20 (TRON) deposit scan + shared post-tick hooks (sweep no-op stub + callback retries). */
export async function runTronDepositTick() {
  return withDepositScanLogCron(TRON_DEPOSIT_CRON, async () => {
    const tickWallStart = Date.now();
    try {
      await loadAppSettingsFromDatabase();
    } catch {
      /* ignore */
    }
    beginDepositScanAddressRound(TRON_DEPOSIT_CRON);
    startWorkerDepositScanTick();
    try {
      if (chainScanEnabled(Chain.TRON)) {
        try {
          await scanTronChain();
          await clearDepositSingleTickForChain(Chain.TRON);
        } catch {
          /* ignore */
        }
      }
    } finally {
      finishWorkerDepositScanTick();
    }
    try {
      await maybeSweepTick();
    } catch {
      /* ignore */
    }
    try {
      await retryStuckSuccessCallbacks();
    } catch {
      /* ignore */
    }
    finishDepositScanAddressRound(Date.now() - tickWallStart, TRON_DEPOSIT_CRON);
  });
}

/** PM2 `crypto-gateway-worker-erc20` — poll interval `WORKER_POLL_INTERVAL_MS_ERC20` (e.g. 4000 ms). */
export function startErc20DepositWorker() {
  if (evmTimer) return;
  const ms = re.workerPollMsErc20;
  evmTimer = setInterval(() => {
    void enqueueEvmDepositWork(runEvmDepositTick);
  }, ms);
  void enqueueEvmDepositWork(runEvmDepositTick);
}

export function stopErc20DepositWorker() {
  if (evmTimer) clearInterval(evmTimer);
  evmTimer = null;
}

/** PM2 `crypto-gateway-worker-trc20` — poll interval `WORKER_POLL_INTERVAL_MS_TRC20` (e.g. 3000 ms). */
export function startTrc20DepositWorker() {
  if (tronTimer) return;
  const ms = re.workerPollMsTrc20;
  tronTimer = setInterval(() => {
    void enqueueTronDepositWork(runTronDepositTick);
  }, ms);
  void enqueueTronDepositWork(runTronDepositTick);
}

export function stopTrc20DepositWorker() {
  if (tronTimer) clearInterval(tronTimer);
  tronTimer = null;
}

/** Combined process: both rails (e.g. `npm run start -w cron` / legacy `entry-worker.js`). */
export function startBlockchainWorker() {
  startErc20DepositWorker();
  startTrc20DepositWorker();
}

export function stopBlockchainWorker() {
  stopErc20DepositWorker();
  stopTrc20DepositWorker();
}
