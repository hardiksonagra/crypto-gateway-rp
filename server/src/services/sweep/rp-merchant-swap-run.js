/**
 * RP portal: preview + run USDT·TRC20 consolidation to a main wallet (TRX fees from that main wallet).
 */
import { randomUUID } from "crypto";
import { Chain as PrismaChain, MerchantGatewayEnv } from "@prisma/client";
import { utils as tronUtils } from "tronweb";
import { ACTIVE } from "../../lib/active-row.js";
import { formatAtomicAmountString } from "../../lib/format-atomic-amount.js";
import { logger } from "../../lib/logger.js";
import {
  parseHumanMinSettlementToAtomic,
} from "../../lib/merchant-fee-math.js";
import { getMerchantWalletMnemonic } from "../../lib/merchant-mnemonic.js";
import {
  getMerchantTrxSweepFunderPrivateKeyHex,
  tronAddressFromPrivateKeyHex,
} from "../../lib/merchant-trx-funder.js";
import { prisma } from "../../lib/prisma.js";
import { deriveTronPrivateKeyHex } from "../wallet/tron-wallet.js";
import {
  pickUsdtTrc20Contract,
  readTronUsdtBalanceAtomicForWallet,
  sweepTronUsdtOne,
} from "./tron-usdt-sweep.js";

/**
 * @param {string} a
 * @param {string} b
 */
function tronAddrEq(a, b) {
  try {
    return tronUtils.address.toHex(a) === tronUtils.address.toHex(b);
  } catch {
    return false;
  }
}

/**
 * @typedef {{
 *   wallet_id: number,
 *   address: string,
 *   usdt_atomic: string,
 *   usdt_decimal: string,
 *   status: "queued" | "funding_trx" | "transferring" | "completed" | "failed" | "skipped",
 *   message: string | null,
 *   tx_hash: string | null,
 * }} RpSwapWalletRow
 */

/**
 * @typedef {{
 *   job_id: string,
 *   running: boolean,
 *   config_id: number,
 *   merchant_id: number,
 *   main_address: string,
 *   min_amount_human: string,
 *   wallets: RpSwapWalletRow[],
 *   logs: { at: string, level: string, message: string }[],
 *   started_at: string | null,
 *   finished_at: string | null,
 *   error: string | null,
 *   processed: number,
 *   total: number,
 * }} RpSwapJob
 */

/** @type {Map<number, RpSwapJob>} */
const jobsByRpId = new Map();

/**
 * @param {number} merchantId
 * @param {string} mainAddress
 * @returns {Promise<{ ok: true, privateKeyHex: string, source: string } | { ok: false, error: string, detail?: string }>}
 */
async function resolveMainWalletSigner(merchantId, mainAddress) {
  const main = String(mainAddress ?? "").trim();
  try {
    tronUtils.address.toHex(main);
  } catch {
    return { ok: false, error: "invalid_main_address" };
  }

  const wallets = await prisma.wallet.findMany({
    where: {
      merchantId,
      environment: MerchantGatewayEnv.live,
      chain: PrismaChain.TRON,
      currency: "USDT",
      network: "TRC20",
      ...ACTIVE,
    },
    select: { address: true, derivationIndex: true },
  });
  const hit = wallets.find((w) => tronAddrEq(w.address, main));
  if (hit) {
    try {
      const mnemonic = await getMerchantWalletMnemonic(merchantId);
      const privateKeyHex = deriveTronPrivateKeyHex(hit.derivationIndex, mnemonic);
      return { ok: true, privateKeyHex, source: "merchant_deposit_wallet" };
    } catch (e) {
      const msg = String(e?.message ?? e);
      logger.error("rp_swap_main_signer_mnemonic_fail", {
        merchant_id: merchantId,
        err: msg,
      });
      if (
        msg.includes("unable to authenticate data") ||
        msg.includes("Unsupported state") ||
        msg.includes("invalid cipher") ||
        msg === "MERCHANT_MNEMONIC_CORRUPT"
      ) {
        return {
          ok: false,
          error: "merchant_mnemonic_decrypt_failed",
          detail:
            "Could not decrypt this merchant’s wallet mnemonic. Local ENCRYPTION_KEY must be the same 64-char hex used when the merchant was created (remote DB ciphertexts will not decrypt with a mismatched key or JWT fallback).",
        };
      }
      if (msg === "MERCHANT_MNEMONIC_NOT_CONFIGURED") {
        return {
          ok: false,
          error: "merchant_mnemonic_missing",
          detail: "This merchant has no encrypted mnemonic (and no legacy MNEMONIC env).",
        };
      }
      return {
        ok: false,
        error: "merchant_mnemonic_unavailable",
        detail: msg.slice(0, 300),
      };
    }
  }

  const funderPk = await getMerchantTrxSweepFunderPrivateKeyHex(merchantId);
  if (funderPk) {
    try {
      const funderAddr = tronAddressFromPrivateKeyHex(funderPk);
      if (tronAddrEq(funderAddr, main)) {
        return { ok: true, privateKeyHex: funderPk, source: "trx_funder_key" };
      }
    } catch {
      /* ignore */
    }
  }

  return {
    ok: false,
    error: "main_wallet_not_signable",
    detail:
      "Main TRON address must be one of this merchant’s gateway USDT·TRC20 deposit wallets (so TRX top-ups can be signed), or match a saved TRX funder key for the merchant.",
  };
}

/**
 * @param {RpSwapJob} job
 * @param {string} level
 * @param {string} message
 */
function pushLog(job, level, message) {
  job.logs.push({
    at: new Date().toISOString(),
    level,
    message,
  });
  if (job.logs.length > 200) job.logs.splice(0, job.logs.length - 200);
}

/**
 * @param {number} rpId
 * @param {number} configId
 */
export async function previewRpMerchantSwap(rpId, configId) {
  const config = await prisma.rpMerchantSwapConfig.findFirst({
    where: { id: configId, resellerPartnerId: rpId, deletedAt: null },
    include: {
      merchant: {
        select: { id: true, email: true, displayName: true, deletedAt: true },
      },
    },
  });
  if (!config || config.merchant.deletedAt) {
    return { ok: false, status: 404, error: "not_found" };
  }

  const signer = await resolveMainWalletSigner(config.merchantId, config.tronAddress);
  if (!signer.ok) {
    return {
      ok: false,
      status: 400,
      error: signer.error,
      message: signer.detail,
    };
  }

  const minParsed = parseHumanMinSettlementToAtomic(config.minAmountHuman, 6);
  if (!minParsed.ok) {
    return { ok: false, status: 400, error: "invalid_min_amount", message: minParsed.error };
  }
  const minAtomic = minParsed.value;

  let contractAddr;
  try {
    contractAddr = pickUsdtTrc20Contract();
  } catch (e) {
    return { ok: false, status: 500, error: "CONFIG", message: String(e) };
  }

  // Live only: same on-chain address often has a sandbox + live wallet row.
  const wallets = await prisma.wallet.findMany({
    where: {
      merchantId: config.merchantId,
      environment: MerchantGatewayEnv.live,
      chain: PrismaChain.TRON,
      currency: "USDT",
      network: "TRC20",
      ...ACTIVE,
    },
    select: {
      id: true,
      address: true,
      derivationIndex: true,
      merchantId: true,
    },
    orderBy: { id: "asc" },
  });

  /** @type {RpSwapWalletRow[]} */
  const eligible = [];
  /** @type {Set<string>} */
  const seenAddr = new Set();
  for (const w of wallets) {
    if (tronAddrEq(w.address, config.tronAddress)) continue;
    let addrKey;
    try {
      addrKey = tronUtils.address.toHex(w.address);
    } catch {
      addrKey = String(w.address).toLowerCase();
    }
    if (seenAddr.has(addrKey)) continue;
    seenAddr.add(addrKey);
    let usdtAtomic;
    try {
      usdtAtomic = await readTronUsdtBalanceAtomicForWallet(w, contractAddr);
    } catch (e) {
      logger.warn("rp_swap_preview_balance_fail", {
        wallet_id: w.id,
        err: String(e),
      });
      continue;
    }
    const above =
      minAtomic === 0n ? usdtAtomic > 0n : usdtAtomic > minAtomic;
    if (!above) continue;
    eligible.push({
      wallet_id: w.id,
      address: w.address,
      usdt_atomic: usdtAtomic.toString(),
      usdt_decimal: formatAtomicAmountString(usdtAtomic.toString(), 6),
      status: "queued",
      message: null,
      tx_hash: null,
    });
  }

  const totalAtomic = eligible.reduce((a, r) => a + BigInt(r.usdt_atomic), 0n);

  return {
    ok: true,
    preview: {
      config_id: config.id,
      merchant_id: config.merchantId,
      merchant_email: config.merchant.email,
      merchant_display_name: config.merchant.displayName,
      main_address: config.tronAddress,
      min_amount_human: config.minAmountHuman,
      main_signer_source: signer.source,
      trx_topup_note:
        "If a deposit wallet needs TRX for fees, native TRX is sent from this main wallet, then USDT is transferred to the same main wallet.",
      wallet_count: eligible.length,
      total_usdt_atomic: totalAtomic.toString(),
      total_usdt_decimal: formatAtomicAmountString(totalAtomic.toString(), 6),
      wallets: eligible,
    },
  };
}

/**
 * @param {number} rpId
 */
export function getRpMerchantSwapJob(rpId) {
  return jobsByRpId.get(rpId) ?? null;
}

/**
 * @param {number} rpId
 * @param {number} configId
 */
export async function startRpMerchantSwapRun(rpId, configId) {
  const existing = jobsByRpId.get(rpId);
  if (existing?.running) {
    return {
      ok: false,
      status: 409,
      error: "swap_run_in_progress",
      message: "A swap run is already in progress for your account.",
      job_id: existing.job_id,
    };
  }

  const preview = await previewRpMerchantSwap(rpId, configId);
  if (!preview.ok) {
    return preview;
  }
  if (preview.preview.wallet_count === 0) {
    return {
      ok: false,
      status: 400,
      error: "no_eligible_wallets",
      message: "No wallets hold more than the minimum USDT (excluding the main wallet).",
    };
  }

  const signer = await resolveMainWalletSigner(
    preview.preview.merchant_id,
    preview.preview.main_address,
  );
  if (!signer.ok) {
    return {
      ok: false,
      status: 400,
      error: signer.error,
      message: signer.detail,
    };
  }

  const jobId = randomUUID();
  /** @type {RpSwapJob} */
  const job = {
    job_id: jobId,
    running: true,
    config_id: configId,
    merchant_id: preview.preview.merchant_id,
    main_address: preview.preview.main_address,
    min_amount_human: preview.preview.min_amount_human,
    wallets: preview.preview.wallets.map((w) => ({ ...w, status: "queued" })),
    logs: [],
    started_at: new Date().toISOString(),
    finished_at: null,
    error: null,
    processed: 0,
    total: preview.preview.wallet_count,
  };
  jobsByRpId.set(rpId, job);
  pushLog(
    job,
    "info",
    `Started swap for merchant #${job.merchant_id} → ${job.main_address} (${job.total} wallet(s)).`,
  );

  void (async () => {
    try {
      for (const row of job.wallets) {
        row.status = "funding_trx";
        row.message = "Checking TRX / preparing transfer…";
        pushLog(job, "info", `Wallet ${row.address}: starting (USDT ${row.usdt_decimal}).`);

        try {
          row.status = "transferring";
          row.message = "Transferring USDT to main wallet…";
          const r = await sweepTronUsdtOne(row.wallet_id, {
            to_address: job.main_address,
            trx_funder_private_key_hex: signer.privateKeyHex,
          });
          if (!r.ok) {
            row.status = "failed";
            row.message = `${r.error}${r.detail ? `: ${r.detail}` : ""}`.slice(0, 500);
            pushLog(job, "error", `Wallet ${row.address}: failed — ${row.message}`);
          } else if (r.skipped) {
            row.status = "skipped";
            row.message = r.reason ?? "skipped";
            pushLog(job, "warn", `Wallet ${row.address}: skipped (${row.message}).`);
          } else {
            row.status = "completed";
            row.tx_hash = r.tx_hash ?? null;
            row.message = r.amount_atomic
              ? `Sent ${formatAtomicAmountString(r.amount_atomic, 6)} USDT`
              : "Sent";
            pushLog(
              job,
              "info",
              `Wallet ${row.address}: completed${row.tx_hash ? ` · tx ${row.tx_hash}` : ""}.`,
            );
          }
        } catch (e) {
          row.status = "failed";
          row.message = String(e).slice(0, 500);
          pushLog(job, "error", `Wallet ${row.address}: ${row.message}`);
        }
        job.processed += 1;
      }
      pushLog(job, "info", "Swap run finished.");
    } catch (e) {
      job.error = String(e).slice(0, 500);
      pushLog(job, "error", `Run aborted: ${job.error}`);
      logger.error("rp_merchant_swap_run_failed", { err: String(e), rp_id: rpId });
    } finally {
      job.running = false;
      job.finished_at = new Date().toISOString();
    }
  })();

  return { ok: true, job };
}
