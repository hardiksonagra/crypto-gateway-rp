import { logger } from "../lib/logger.js";
import { env } from "../config/env.js";

export async function maybeSweepTick() {
  if (
    !env.sweepMasterEvm &&
    !env.sweepMasterTron &&
    !env.sweepMasterBtc &&
    !env.sweepMasterSolana
  ) {
    return;
  }
  logger.debug("sweep tick: configure per-chain signers to enable automated sweeps", {
    hasEvm: Boolean(env.sweepMasterEvm),
    hasTron: Boolean(env.sweepMasterTron),
    hasBtc: Boolean(env.sweepMasterBtc),
    hasSolana: Boolean(env.sweepMasterSolana),
  });
}
