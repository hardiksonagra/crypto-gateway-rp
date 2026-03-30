import { Chain } from "@prisma/client";
import { SCANNED_EVM_CHAINS } from "crypto-payment-gateway/src/config/chains.js";
import { re } from "crypto-payment-gateway/src/config/runtime-env.js";
import { logger } from "crypto-payment-gateway/src/lib/logger.js";
import { loadWalletsForChainLateCatchup } from "crypto-payment-gateway/src/services/payment/transaction-upsert.js";
import {
  finishWorkerDepositScanTick,
  startWorkerDepositScanTick,
} from "crypto-payment-gateway/src/services/tracker/deposit-rail-metrics.js";
import { scanBtcChain } from "./btc-tracker.js";
import { scanEvmChain } from "./evm-tracker.js";
import { scanTronChain } from "./tron-tracker.js";
import { scanTonChain } from "./ton-tracker.js";
import { maybeSweepTick } from "crypto-payment-gateway/src/services/sweep-service.js";
import { retryStuckSuccessCallbacks } from "crypto-payment-gateway/src/services/callback-retry.js";

let timer = null;
/** @type {number} */
let lastLateDepositRecheckMs = 0;

export function startBlockchainWorker() {
  if (timer) return;
  timer = setInterval(() => {
    void runTick();
  }, re.workerPollMs);
  void runTick();
}

export function stopBlockchainWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}

async function runTick() {
  startWorkerDepositScanTick();
  try {
    if (!re.depositScannerTronOnly) {
      for (const chain of SCANNED_EVM_CHAINS) {
        try {
          await scanEvmChain(chain);
        } catch (e) {
          logger.error("evm scan failed", { chain, err: String(e) });
        }
      }
    }
    try {
      await scanTronChain();
    } catch (e) {
      logger.error("tron scan failed", { err: String(e) });
    }
    if (!re.depositScannerTronOnly) {
      try {
        await scanTonChain();
      } catch (e) {
        logger.error("ton scan failed", { err: String(e) });
      }
    }
  } finally {
    finishWorkerDepositScanTick();
  }
  try {
    await maybeSweepTick();
  } catch (e) {
    logger.error("sweep tick failed", { err: String(e) });
  }
  try {
    await retryStuckSuccessCallbacks();
  } catch (e) {
    logger.error("callback retry tick failed", { err: String(e) });
  }

  await maybeLateDepositRecheck();
}

/**
 * Expired, zero-tx wallets: TRON / TON / BTC address APIs can still see late on-chain pays.
 * EVM is omitted (block cursor only moves forward; use reactivate for ETH/BSC missed deposits).
 */
async function maybeLateDepositRecheck() {
  const hours = re.lateDepositRecheckHours;
  if (hours <= 0 || re.walletScanTtlMinutes <= 0) return;

  const intervalMs = hours * 3600 * 1000;
  const now = Date.now();
  if (now - lastLateDepositRecheckMs < intervalMs) return;
  lastLateDepositRecheckMs = now;

  const counts = { tron: 0, ton: 0, btc: 0 };
  try {
    const tronW = await loadWalletsForChainLateCatchup(Chain.TRON);
    counts.tron = tronW.length;
    if (tronW.length) await scanTronChain({ wallets: tronW });
  } catch (e) {
    logger.error("late deposit recheck tron failed", { err: String(e) });
  }
  if (!re.depositScannerTronOnly) {
    try {
      const tonW = await loadWalletsForChainLateCatchup(Chain.TON);
      counts.ton = tonW.length;
      if (tonW.length) await scanTonChain({ wallets: tonW });
    } catch (e) {
      logger.error("late deposit recheck ton failed", { err: String(e) });
    }
    try {
      const btcW = await loadWalletsForChainLateCatchup(Chain.BTC);
      counts.btc = btcW.length;
      if (btcW.length) await scanBtcChain({ wallets: btcW });
    } catch (e) {
      logger.error("late deposit recheck btc failed", { err: String(e) });
    }
  }

  const total = counts.tron + counts.ton + counts.btc;
  if (total > 0) {
    logger.info("late_deposit_recheck", {
      hours,
      wallets_tron: counts.tron,
      wallets_ton: counts.ton,
      wallets_btc: counts.btc,
      deposit_scanner_tron_only: re.depositScannerTronOnly,
      note: "EVM not included; forward-only scanner",
    });
  }
}
