/** Post-deposit treasury routing: `getMerchantAutoSwapPlan` in `server/src/lib/merchant-auto-swap-settings.js`. */
import { Chain, MerchantGatewayEnv } from "@prisma/client";
import { utils as tronUtils } from "tronweb";
import { getMerchantWalletMnemonic } from "../../lib/merchant-mnemonic.js";
import { ACTIVE } from "../../lib/active-row.js";
import { logger } from "../../lib/logger.js";
import { prisma } from "../../lib/prisma.js";
import { resolveMerchantTronUsdtSweepFromSettings } from "../../lib/merchant-auto-swap-settings.js";
import { getMerchantTrxSweepFunderPrivateKeyHex } from "../../lib/merchant-trx-funder.js";
import {
  sendTrxNativeTopUpFromPrivateKey,
  TRX_TOPUP_SETTLE_MS,
  TRX_TOPUP_SEND_BUFFER_SUN,
} from "./tron-trx-topup.js";
import { acquireOutboundRpcSlot } from "../../lib/network-rpc-rate-limit.js";
import { deriveTronPrivateKeyHex } from "../wallet/tron-wallet.js";
import {
  createTronWebFromPrivateKeyHex,
  estimateTrxSunRequiredForTrc20Transfer,
  pickUsdtTrc20Contract,
  readTronUsdtBalanceAtomicForWallet,
  sweepTronUsdtTransferFullBalanceFromDepositWallet,
} from "./tron-usdt-sweep.js";

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
 * One deposit wallet: optional TRX top-up, then USDT → `master` when balance clears the minimum rule.
 *
 * @param {{ id: string, address: string, derivationIndex: number, merchantId: number }} wallet
 * @param {string} master Base58 treasury (platform sweep master or merchant auto-swap destination).
 * @param {bigint} minAtomic Minimum threshold (6-decimal USDT atomic). See `minExclusiveAbove`.
 * @param {boolean} [minExclusiveAbove] When true (merchant auto-swap), sweep only if balance **&gt;** `minAtomic`. When false (platform sweep), use **≥** (`usdt` &gt;= min).
 */
export async function sweepTronUsdtOneWithAutoTopUp(
  wallet,
  master,
  contractAddr,
  minAtomic,
  minExclusiveAbove = false,
) {

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

  const belowMin = minExclusiveAbove
    ? minAtomic > 0n && usdtAtomic <= minAtomic
    : usdtAtomic < minAtomic;
  if (belowMin) {
    logger.info("tron_auto_sweep_skip_below_min", {
      event: "tron_auto_sweep_skip_below_min",
      at: new Date().toISOString(),
      wallet_id: wallet.id,
      merchant_id: wallet.merchantId,
      deposit_address: wallet.address,
      usdt_atomic: usdtAtomic.toString(),
      min_usdt_atomic: minAtomic.toString(),
      min_exclusive_above: minExclusiveAbove,
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

  const merchantTrxFunderPk = await getMerchantTrxSweepFunderPrivateKeyHex(wallet.merchantId);

  const mnemonicPhrase = await getMerchantWalletMnemonic(wallet.merchantId);
  const pkHex = deriveTronPrivateKeyHex(wallet.derivationIndex, mnemonicPhrase);
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
    const sendSun = gap + TRX_TOPUP_SEND_BUFFER_SUN;

    if (!String(merchantTrxFunderPk ?? "").trim()) {
      logger.warn("tron_auto_sweep_need_trx_no_merchant_funder", {
        event: "tron_auto_sweep_need_trx_no_merchant_funder",
        at: new Date().toISOString(),
        wallet_id: wallet.id,
        merchant_id: wallet.merchantId,
        deposit_address: wallet.address,
        trx_sun_have: trxSun.toString(),
        trx_sun_need_estimated: neededTrxSun.toString(),
        usdt_atomic: usdtAtomic.toString(),
      });
      return {
        status: "failed",
        error: "MERCHANT_TRX_FUNDER_KEY_REQUIRED",
        detail:
          "Deposit wallet needs more TRX for fees. Save your TRX funder private key under Gateway & webhooks (platform env is not used).",
      };
    }

    const top = await sendTrxNativeTopUpFromPrivateKey(
      wallet.address,
      sendSun,
      merchantTrxFunderPk,
    );
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

    await sleep(TRX_TOPUP_SETTLE_MS);

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
 * @param {number} merchantId
 * @returns {Promise<
 *   | { ok: true, master: string, minAtomic: bigint, minExclusiveAbove: boolean, mode: "merchant_settings" }
 *   | { ok: false, reason: string, message?: string }
 * >}
 */
async function resolveTronUsdtSweepTargetForMerchant(merchantId) {
  const r = await resolveMerchantTronUsdtSweepFromSettings(merchantId);
  if (!r.ok) {
    return { ok: false, reason: r.reason, message: r.message };
  }
  return {
    ok: true,
    master: r.master,
    minAtomic: r.minAtomic,
    minExclusiveAbove: r.minExclusiveAbove,
    mode: "merchant_settings",
  };
}

/**
 * Live TRON USDT·TRC20 wallets — TRX top-up from merchant-configured funder only, then sweep to merchant treasury.
 *
 * @returns {Promise<{ round_started_at: string, master: string, wallet_count: number, results: object[] }>}
 */
export async function runAutomatedTronUsdtSweepRound() {
  const started = new Date().toISOString();

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
    return {
      round_started_at: started,
      master: "",
      wallet_count: 0,
      results: [],
    };
  }

  const wallets = await prisma.wallet.findMany({
    where: {
      chain: Chain.TRON,
      currency: "USDT",
      network: "TRC20",
      environment: MerchantGatewayEnv.live,
      ...ACTIVE,
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, address: true, derivationIndex: true, merchantId: true },
  });

  const merchantIds = [...new Set(wallets.map((w) => w.merchantId))];
  /** @type {Map<number, Awaited<ReturnType<typeof resolveTronUsdtSweepTargetForMerchant>>>} */
  const targetByMerchant = new Map();
  for (const mid of merchantIds) {
    targetByMerchant.set(mid, await resolveTronUsdtSweepTargetForMerchant(mid));
  }

  logger.info("tron_auto_sweep_round_start", {
    event: "tron_auto_sweep_round_start",
    at: started,
    wallet_count: wallets.length,
    trx_fee_model: "dynamic_estimate_energy_bandwidth; merchant_trx_funder_only",
    merchants_resolved: merchantIds.length,
  });

  /** @type {object[]} */
  const results = [];
  for (const w of wallets) {
    const cfg = targetByMerchant.get(w.merchantId);
    if (!cfg || !cfg.ok) {
      results.push({
        wallet_id: w.id,
        merchant_id: w.merchantId,
        address: w.address,
        status: "skipped",
        reason: cfg && !cfg.ok ? cfg.reason : "unknown_sweep_config",
        ...(cfg && !cfg.ok && cfg.message ? { message: cfg.message } : {}),
      });
      continue;
    }
    const r = await sweepTronUsdtOneWithAutoTopUp(
      w,
      cfg.master,
      contractAddr,
      cfg.minAtomic,
      cfg.minExclusiveAbove,
    );
    results.push({
      wallet_id: w.id,
      merchant_id: w.merchantId,
      address: w.address,
      sweep_mode: cfg.mode,
      ...r,
    });
  }

  const swept = results.filter((x) => x.status === "swept").length;
  const skipped = results.filter((x) => x.status === "skipped").length;
  const failed = results.filter((x) => x.status === "failed").length;

  logger.info("tron_auto_sweep_round_complete", {
    event: "tron_auto_sweep_round_complete",
    at: new Date().toISOString(),
    round_started_at: started,
    wallet_count: wallets.length,
    swept,
    skipped,
    failed,
  });

  return {
    round_started_at: started,
    master: "",
    wallet_count: wallets.length,
    results,
  };
}
