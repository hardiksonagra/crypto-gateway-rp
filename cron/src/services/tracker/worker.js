import { Chain, MerchantGatewayEnv } from "@prisma/client";
import { SCANNED_EVM_CHAINS } from "crypto-payment-gateway/src/config/chains.js";
import { re } from "crypto-payment-gateway/src/config/runtime-env.js";
import { logger } from "crypto-payment-gateway/src/lib/logger.js";
import { prisma } from "crypto-payment-gateway/src/lib/prisma.js";
import { loadWalletsForChain } from "crypto-payment-gateway/src/services/payment/transaction-upsert.js";
import {
  beginDepositScanAddressRound,
  finishDepositScanAddressRound,
  finishWorkerDepositScanTick,
  startWorkerDepositScanTick,
} from "crypto-payment-gateway/src/services/tracker/deposit-rail-metrics.js";
import { scanBtcChain } from "./btc-tracker.js";
import { scanEvmChain } from "./evm-tracker.js";
import { scanTronChain } from "./tron-tracker.js";
import { scanTonChain } from "./ton-tracker.js";
import { maybeSweepTick } from "crypto-payment-gateway/src/services/sweep-service.js";
import { retryStuckSuccessCallbacks } from "crypto-payment-gateway/src/services/callback-retry.js";
import { isChainLiveForPlatform } from "crypto-payment-gateway/src/lib/chain-enable.js";

let timer = null;

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
  beginDepositScanAddressRound();
  startWorkerDepositScanTick();
  try {
    if (!re.depositScannerTronOnly) {
      for (const chain of SCANNED_EVM_CHAINS) {
        if (!chainScanEnabled(chain)) continue;
        try {
          await scanEvmChain(chain);
          await clearDepositSingleTickForChain(chain);
        } catch (e) {
          logger.error("evm scan failed", { chain, err: String(e) });
        }
      }
    } else {
      for (const chain of SCANNED_EVM_CHAINS) {
        if (!chainScanEnabled(chain)) continue;
        try {
          const w = await loadWalletsForChain(chain);
          if (w.length === 0) continue;
          await scanEvmChain(chain, { wallets: w });
          await clearDepositSingleTickForChain(chain);
        } catch (e) {
          logger.error("evm scan failed", { chain, err: String(e) });
        }
      }
    }
    try {
      if (chainScanEnabled(Chain.TRON)) {
        await scanTronChain();
        await clearDepositSingleTickForChain(Chain.TRON);
      }
    } catch (e) {
      logger.error("tron_scan_failed", {
        event: "tron_scan_failed",
        err: String(e),
        stack: e instanceof Error ? e.stack : undefined,
      });
    }
    if (!re.depositScannerTronOnly) {
      try {
        if (chainScanEnabled(Chain.TON)) {
          await scanTonChain();
          await clearDepositSingleTickForChain(Chain.TON);
        }
      } catch (e) {
        logger.error("ton scan failed", { err: String(e) });
      }
      try {
        if (chainScanEnabled(Chain.BTC)) {
          await scanBtcChain();
          await clearDepositSingleTickForChain(Chain.BTC);
        }
      } catch (e) {
        logger.error("btc scan failed", { err: String(e) });
      }
    } else {
      try {
        if (chainScanEnabled(Chain.TON)) {
          const tonW = await loadWalletsForChain(Chain.TON);
          if (tonW.length > 0) {
            await scanTonChain({ wallets: tonW });
            await clearDepositSingleTickForChain(Chain.TON);
          }
        }
      } catch (e) {
        logger.error("ton scan failed", { err: String(e) });
      }
      try {
        if (chainScanEnabled(Chain.BTC)) {
          const btcW = await loadWalletsForChain(Chain.BTC);
          if (btcW.length > 0) {
            await scanBtcChain({ wallets: btcW });
            await clearDepositSingleTickForChain(Chain.BTC);
          }
        }
      } catch (e) {
        logger.error("btc scan failed", { err: String(e) });
      }
    }
  } finally {
    finishWorkerDepositScanTick();
    finishDepositScanAddressRound();
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
}
