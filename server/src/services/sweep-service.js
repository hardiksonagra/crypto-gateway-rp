import { logger } from "../lib/logger.js";
import { re } from "../config/runtime-env.js";

export async function maybeSweepTick() {
  if (!re.sweepMasterTron?.trim() && !re.sweepMasterUsdtEth?.trim()) {
    return;
  }
  logger.debug("sweep tick: configure per-chain signers to enable automated sweeps", {
    hasTron: Boolean(re.sweepMasterTron?.trim()),
    hasUsdtEth: Boolean(re.sweepMasterUsdtEth?.trim()),
  });
}
