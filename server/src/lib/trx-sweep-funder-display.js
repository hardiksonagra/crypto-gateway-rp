import { env } from "../config/env.js";
import { re } from "../config/runtime-env.js";
import { createTronWebFromPrivateKeyHex } from "../services/sweep/tron-usdt-sweep.js";

/**
 * Base58 TRX address used when the platform tops up deposit wallets for USDT·TRC20 sweeps:
 * `SWEEP_TRX_FUNDER_ADDRESS`, or derived from `SWEEP_TRX_FUNDER_PRIVATE_KEY` when the address env is unset.
 *
 * @returns {string} Empty string when fee top-up is not configured.
 */
export function getTrxSweepFunderDisplayAddress() {
  const explicit = re.sweepTrxFunderAddress?.trim();
  if (explicit) return explicit;
  const pk = env.sweepTrxFunderPrivateKey?.trim();
  if (!pk) return "";
  try {
    const tw = createTronWebFromPrivateKeyHex(pk);
    return typeof tw.defaultAddress?.base58 === "string" ? tw.defaultAddress.base58 : "";
  } catch {
    return "";
  }
}
