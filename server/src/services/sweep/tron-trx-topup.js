/**
 * Native TRX top-up from a known private key (merchant-configured only — no platform env fallback).
 */
import { TronWeb } from "tronweb";
import { formatAtomicAmountString } from "../../lib/format-atomic-amount.js";
import { logger } from "../../lib/logger.js";
import { acquireOutboundRpcSlot } from "../../lib/network-rpc-rate-limit.js";
import {
  getTronFullNodeBase,
  getTronProgApiKeyHeaders,
} from "../../lib/tron-node-client.js";

/** After native TRX top-up, wait before re-reading balance / sweeping. */
export const TRX_TOPUP_SETTLE_MS = 12_000;

/** Small cushion on top-up size only (fee estimate vs actual inbound rounding). */
export const TRX_TOPUP_SEND_BUFFER_SUN = 150_000n;

/** Keep this much sun on funder after each outbound (approx. one more fee). */
export const TRX_FUNDER_RESERVE_SUN = 3_000_000n;

/**
 * @param {string} privateKeyHex
 */
function tronWebFromPrivateKeyHex(privateKeyHex) {
  const pk = String(privateKeyHex ?? "").replace(/^0x/i, "");
  return new TronWeb({
    fullHost: getTronFullNodeBase(),
    headers: getTronProgApiKeyHeaders(),
    privateKey: pk,
  });
}

/**
 * Send native TRX from `fromPrivateKeyHex` wallet to `toAddress` (base58).
 *
 * @param {string} toAddress base58
 * @param {bigint} amountSun
 * @param {string} fromPrivateKeyHex
 * @returns {Promise<
 *   | { ok: true, tx_hash: string, funder_address: string, trx_sun: string }
 *   | { ok: false, error: string, detail?: string, funder_address?: string }
 * >}
 */
export async function sendTrxNativeTopUpFromPrivateKey(
  toAddress,
  amountSun,
  fromPrivateKeyHex,
) {
  const pk = String(fromPrivateKeyHex ?? "").trim();
  if (!pk) {
    return { ok: false, error: "NO_FUNDER_KEY" };
  }

  const tw = tronWebFromPrivateKeyHex(pk);
  const from = tw.defaultAddress.base58;

  await acquireOutboundRpcSlot("TRON");
  const bal = BigInt(await tw.trx.getBalance(from));
  if (bal < amountSun + TRX_FUNDER_RESERVE_SUN) {
    logger.warn("trx_topup_funder_short", {
      event: "trx_topup_funder_short",
      at: new Date().toISOString(),
      funder_address: from,
      funder_trx_sun: bal.toString(),
      needed_trx_sun: amountSun.toString(),
      reserve_sun: TRX_FUNDER_RESERVE_SUN.toString(),
    });
    const needSun = amountSun + TRX_FUNDER_RESERVE_SUN;
    return {
      ok: false,
      error: "FUNDER_INSUFFICIENT_TRX",
      funder_address: from,
      detail: `have ${formatAtomicAmountString(bal, 6)} TRX, need ${formatAtomicAmountString(needSun, 6)} TRX`,
    };
  }

  await acquireOutboundRpcSlot("TRON");
  const built = await tw.transactionBuilder.sendTrx(
    toAddress,
    Number(amountSun),
    from,
  );
  const signed = await tw.trx.sign(built);
  const receipt = await tw.trx.sendRawTransaction(signed);
  const ok = receipt?.result === true;
  const txid =
    (typeof receipt?.txid === "string" && receipt.txid) ||
    /** @type {{ txID?: string }} */ (signed)?.txID ||
    null;

  if (!ok || !txid) {
    logger.error("trx_topup_broadcast_fail", {
      event: "trx_topup_broadcast_fail",
      at: new Date().toISOString(),
      to_address: toAddress,
      trx_sun: amountSun.toString(),
      funder_address: from,
      receipt: JSON.stringify(receipt ?? {}).slice(0, 500),
    });
    return {
      ok: false,
      error: "TRX_TOPUP_BROADCAST_FAILED",
      detail: JSON.stringify(receipt ?? {}),
    };
  }

  logger.info("trx_topup_sent", {
    event: "trx_topup_sent",
    at: new Date().toISOString(),
    deposit_address: toAddress,
    funder_address: from,
    trx_sun_sent: amountSun.toString(),
    trx_topup_tx_hash: txid,
  });

  return {
    ok: true,
    tx_hash: txid,
    funder_address: from,
    trx_sun: amountSun.toString(),
  };
}
