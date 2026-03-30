import { logger } from "../lib/logger.js";
import { re } from "../config/runtime-env.js";

export async function maybeSweepTick() {
  if (
    !re.sweepMasterEvm &&
    !re.sweepMasterTron &&
    !re.sweepMasterBtc &&
    !re.sweepMasterSolana
  ) {
    return;
  }
  logger.debug("sweep tick: configure per-chain signers to enable automated sweeps", {
    hasEvm: Boolean(re.sweepMasterEvm),
    hasTron: Boolean(re.sweepMasterTron),
    hasTrxMaster: Boolean(re.sweepMasterTrx?.trim() || re.sweepMasterTron?.trim()),
    hasUsdtEth: Boolean(re.sweepMasterUsdtEth?.trim()),
    hasUsdtBnb: Boolean(re.sweepMasterUsdtBnb?.trim()),
    hasBtc: Boolean(re.sweepMasterBtc),
    hasSolana: Boolean(re.sweepMasterSolana),
  });
}
