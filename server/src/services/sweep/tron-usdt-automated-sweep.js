import { Chain, MerchantGatewayEnv } from "@prisma/client";
import { utils as tronUtils } from "tronweb";
import { env } from "../../config/env.js";
import { re } from "../../config/runtime-env.js";
import { logger } from "../../lib/logger.js";
import { prisma } from "../../lib/prisma.js";
import { acquireOutboundRpcSlot } from "../../lib/network-rpc-rate-limit.js";
import { deriveTronPrivateKeyHex } from "../wallet/tron-wallet.js";
import {
  createTronWebFromPrivateKeyHex,
  estimateTrxSunRequiredForTrc20Transfer,
  pickUsdtTrc20Contract,
  readTronUsdtBalanceAtomicForWallet,
  sweepTronUsdtTransferFullBalanceFromDepositWallet,
} from "./tron-usdt-sweep.js";

/** After native TRX top-up, wait before re-reading balance / sweeping. */
const TOPUP_SETTLE_MS = 12_000;

/** Small cushion on top-up size only (fee estimate vs actual inbound rounding). */
const TOPUP_SEND_BUFFER_SUN = 150_000n;

/** Keep this much sun on funder after each outbound (approx. one more fee). */
const FUNDER_RESERVE_SUN = 3_000_000n;

function tronAddrEq(a, b) {
  try {
    return tronUtils.address.toHex(a) === tronUtils.address.toHex(b);
  } catch {
    return a === b;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Send native TRX from `SWEEP_TRX_FUNDER_PRIVATE_KEY` wallet to a deposit address.
 *
 * @param {string} toAddress base58
 * @param {bigint} amountSun
 */
async function sendTrxTopUpFromFunder(toAddress, amountSun) {
  const pk = env.sweepTrxFunderPrivateKey?.trim();
  if (!pk) {
    return { ok: false, error: "NO_FUNDER_KEY" };
  }

  const tw = createTronWebFromPrivateKeyHex(pk);
  const from = tw.defaultAddress.base58;

  const expectAddr = re.sweepTrxFunderAddress?.trim();
  if (expectAddr && !tronAddrEq(from, expectAddr)) {
    logger.error("tron_auto_sweep_funder_address_mismatch", {
      event: "tron_auto_sweep_funder_address_mismatch",
      at: new Date().toISOString(),
      derived_funder_address: from,
      env_sweep_trx_funder_address: expectAddr,
    });
    return { ok: false, error: "FUNDER_ADDRESS_MISMATCH" };
  }

  await acquireOutboundRpcSlot("TRON");
  const bal = BigInt(await tw.trx.getBalance(from));
  if (bal < amountSun + FUNDER_RESERVE_SUN) {
    logger.warn("tron_auto_sweep_trx_topup_funder_short", {
      event: "tron_auto_sweep_trx_topup_funder_short",
      at: new Date().toISOString(),
      funder_address: from,
      funder_trx_sun: bal.toString(),
      needed_trx_sun: amountSun.toString(),
      reserve_sun: FUNDER_RESERVE_SUN.toString(),
    });
    return {
      ok: false,
      error: "FUNDER_INSUFFICIENT_TRX",
      funder_address: from,
      detail: `have ${bal} sun, need ${amountSun + FUNDER_RESERVE_SUN}`,
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
    logger.error("tron_auto_sweep_trx_topup_broadcast_fail", {
      event: "tron_auto_sweep_trx_topup_broadcast_fail",
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

  logger.info("tron_auto_sweep_trx_topup", {
    event: "tron_auto_sweep_trx_topup",
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

/**
 * One deposit wallet: optional TRX top-up, then USDT → master if balance ≥ min.
 *
 * @param {{ id: string, address: string, derivationIndex: number }} wallet
 */
export async function sweepTronUsdtOneWithAutoTopUp(
  wallet,
  master,
  contractAddr,
) {
  const minAtomic = re.sweepTronUsdtMinAtomic;

  if (tronAddrEq(wallet.address, master)) {
    return { status: "skipped", reason: "source_is_master" };
  }

  let usdtAtomic;
  try {
    usdtAtomic = await readTronUsdtBalanceAtomicForWallet(wallet, contractAddr);
  } catch (e) {
    logger.error("tron_auto_sweep_usdt_read_fail", {
      event: "tron_auto_sweep_usdt_read_fail",
      at: new Date().toISOString(),
      wallet_id: wallet.id,
      deposit_address: wallet.address,
      err: String(e),
    });
    return {
      status: "failed",
      error: "USDT_BALANCE_READ_FAILED",
      detail: String(e),
    };
  }

  if (usdtAtomic < minAtomic) {
    logger.info("tron_auto_sweep_skip_below_min", {
      event: "tron_auto_sweep_skip_below_min",
      at: new Date().toISOString(),
      wallet_id: wallet.id,
      deposit_address: wallet.address,
      usdt_atomic: usdtAtomic.toString(),
      min_usdt_atomic: minAtomic.toString(),
    });
    return {
      status: "skipped",
      reason: "below_min_usdt",
      usdt_atomic: usdtAtomic.toString(),
    };
  }

  if (usdtAtomic <= 0n) {
    logger.info("tron_auto_sweep_skip_zero_usdt", {
      event: "tron_auto_sweep_skip_zero_usdt",
      at: new Date().toISOString(),
      wallet_id: wallet.id,
      deposit_address: wallet.address,
    });
    return { status: "skipped", reason: "zero_usdt" };
  }

  const pkHex = deriveTronPrivateKeyHex(wallet.derivationIndex, env.mnemonic);
  const depositTw = createTronWebFromPrivateKeyHex(pkHex);

  const neededTrxSun = await estimateTrxSunRequiredForTrc20Transfer(
    depositTw,
    wallet.address,
    contractAddr,
    master,
    usdtAtomic,
  );

  await acquireOutboundRpcSlot("TRON");
  let trxSun = BigInt(await depositTw.trx.getBalance(wallet.address));

  if (trxSun < neededTrxSun) {
    const gap = neededTrxSun - trxSun;
    const sendSun = gap + TOPUP_SEND_BUFFER_SUN;

    if (!env.sweepTrxFunderPrivateKey?.trim()) {
      logger.warn("tron_auto_sweep_need_trx_no_funder", {
        event: "tron_auto_sweep_need_trx_no_funder",
        at: new Date().toISOString(),
        wallet_id: wallet.id,
        deposit_address: wallet.address,
        trx_sun_have: trxSun.toString(),
        trx_sun_need_estimated: neededTrxSun.toString(),
        usdt_atomic: usdtAtomic.toString(),
      });
      return {
        status: "failed",
        error: "INSUFFICIENT_TRX_NO_FUNDER",
        detail: `have ${trxSun} sun, need ~${neededTrxSun} sun (estimated), set SWEEP_TRX_FUNDER_PRIVATE_KEY`,
      };
    }

    const top = await sendTrxTopUpFromFunder(wallet.address, sendSun);
    if (!top.ok) {
      logger.error("tron_auto_sweep_trx_topup_failed", {
        event: "tron_auto_sweep_trx_topup_failed",
        at: new Date().toISOString(),
        wallet_id: wallet.id,
        deposit_address: wallet.address,
        error: top.error,
        detail: top.detail,
      });
      return { status: "failed", error: top.error, detail: top.detail };
    }

    await sleep(TOPUP_SETTLE_MS);

    await acquireOutboundRpcSlot("TRON");
    trxSun = BigInt(await depositTw.trx.getBalance(wallet.address));

    logger.info("tron_auto_sweep_trx_balance_after_topup", {
      event: "tron_auto_sweep_trx_balance_after_topup",
      at: new Date().toISOString(),
      wallet_id: wallet.id,
      deposit_address: wallet.address,
      trx_sun: trxSun.toString(),
      topup_tx: top.tx_hash,
    });
  }

  const sweep = await sweepTronUsdtTransferFullBalanceFromDepositWallet(
    wallet,
    master,
    contractAddr,
  );

  if (!sweep.ok) {
    logger.error("tron_auto_sweep_usdt_transfer_failed", {
      event: "tron_auto_sweep_usdt_transfer_failed",
      at: new Date().toISOString(),
      wallet_id: wallet.id,
      deposit_address: wallet.address,
      error: sweep.error,
      detail: sweep.detail,
      trx_sun_after: trxSun.toString(),
    });
    return {
      status: "failed",
      error: sweep.error,
      detail: sweep.detail,
    };
  }

  if (sweep.skipped) {
    logger.info("tron_auto_sweep_usdt_skipped_inner", {
      event: "tron_auto_sweep_usdt_skipped_inner",
      at: new Date().toISOString(),
      wallet_id: wallet.id,
      deposit_address: wallet.address,
      reason: sweep.reason,
    });
    return { status: "skipped", reason: sweep.reason ?? "inner_skip" };
  }

  logger.info("tron_auto_sweep_usdt_sent", {
    event: "tron_auto_sweep_usdt_sent",
    at: new Date().toISOString(),
    wallet_id: wallet.id,
    from_address: sweep.from_address,
    to_address_master: sweep.to_address,
    usdt_atomic: sweep.amount_atomic,
    usdt_transfer_tx_hash: sweep.tx_hash,
  });

  return {
    status: "swept",
    usdt_atomic: sweep.amount_atomic,
    usdt_tx_hash: sweep.tx_hash,
  };
}

/**
 * Live TRON USDT·TRC20 wallets, oldest first — TRX top-up (if configured) then sweep to `SWEEP_MASTER_TRON`.
 *
 * @returns {Promise<{ round_started_at: string, master: string, wallet_count: number, results: object[] }>}
 */
export async function runAutomatedTronUsdtSweepRound() {
  const started = new Date().toISOString();
  const master = re.sweepMasterTron?.trim() ?? "";
  if (!master) {
    logger.warn("tron_auto_sweep_round_aborted", {
      event: "tron_auto_sweep_round_aborted",
      at: started,
      reason: "SWEEP_MASTER_TRON_NOT_SET",
    });
    return {
      round_started_at: started,
      master: "",
      wallet_count: 0,
      results: [],
    };
  }

  let contractAddr;
  try {
    contractAddr = pickUsdtTrc20Contract();
  } catch (e) {
    logger.error("tron_auto_sweep_round_aborted", {
      event: "tron_auto_sweep_round_aborted",
      at: started,
      reason: "NO_USDT_TRC20_CONTRACT",
      err: String(e),
    });
    return { round_started_at: started, master, wallet_count: 0, results: [] };
  }

  const wallets = await prisma.wallet.findMany({
    where: {
      chain: Chain.TRON,
      currency: "USDT",
      network: "TRC20",
      environment: MerchantGatewayEnv.live,
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, address: true, derivationIndex: true },
  });

  logger.info("tron_auto_sweep_round_start", {
    event: "tron_auto_sweep_round_start",
    at: started,
    master_address: master,
    wallet_count: wallets.length,
    min_usdt_atomic: re.sweepTronUsdtMinAtomic.toString(),
    trx_fee_model: "dynamic_estimate_energy_bandwidth",
    funder_configured: Boolean(env.sweepTrxFunderPrivateKey?.trim()),
  });

  /** @type {object[]} */
  const results = [];
  for (const w of wallets) {
    const r = await sweepTronUsdtOneWithAutoTopUp(w, master, contractAddr);
    results.push({ wallet_id: w.id, address: w.address, ...r });
  }

  const swept = results.filter((x) => x.status === "swept").length;
  const skipped = results.filter((x) => x.status === "skipped").length;
  const failed = results.filter((x) => x.status === "failed").length;

  logger.info("tron_auto_sweep_round_complete", {
    event: "tron_auto_sweep_round_complete",
    at: new Date().toISOString(),
    round_started_at: started,
    master_address: master,
    wallet_count: wallets.length,
    swept,
    skipped,
    failed,
  });

  return {
    round_started_at: started,
    master,
    wallet_count: wallets.length,
    results,
  };
}
