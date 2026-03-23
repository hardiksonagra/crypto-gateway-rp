import { EVM_CHAINS } from "../../config/chains.js";
import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { scanEvmChain } from "./evm-tracker.js";
import { scanTronChain } from "./tron-tracker.js";
import { scanBtcChain } from "./btc-tracker.js";
import { scanTonChain } from "./ton-tracker.js";
import { maybeSweepTick } from "../sweep-service.js";
import { retryStuckSuccessCallbacks } from "../callback-retry.js";

let timer = null;

export function startBlockchainWorker() {
  if (timer) return;
  timer = setInterval(() => {
    void runTick();
  }, env.workerPollMs);
  void runTick();
}

export function stopBlockchainWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}

async function runTick() {
  for (const chain of EVM_CHAINS) {
    try {
      await scanEvmChain(chain);
    } catch (e) {
      logger.error("evm scan failed", { chain, err: String(e) });
    }
  }
  try {
    await scanTronChain();
  } catch (e) {
    logger.error("tron scan failed", { err: String(e) });
  }
  try {
    await scanBtcChain();
  } catch (e) {
    logger.error("btc scan failed", { err: String(e) });
  }
  try {
    await scanTonChain();
  } catch (e) {
    logger.error("ton scan failed", { err: String(e) });
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
