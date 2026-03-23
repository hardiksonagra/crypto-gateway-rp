import { logger } from "../lib/logger.js";
import { env } from "../config/env.js";

/**
 * Hot-wallet sweep: move deposits to cold storage / omnibus account.
 * This module is intentionally minimal — wire signing + broadcast per chain in a secure enclave.
 * Never load the mnemonic into this process in production; use HSM/KMS-backed signers instead.
 */
export async function maybeSweepTick(): Promise<void> {
  if (!env.sweepMasterEvm && !env.sweepMasterTron && !env.sweepMasterBtc) return;
  logger.debug("sweep tick: configure per-chain signers to enable automated sweeps", {
    hasEvm: Boolean(env.sweepMasterEvm),
    hasTron: Boolean(env.sweepMasterTron),
    hasBtc: Boolean(env.sweepMasterBtc),
  });
}
