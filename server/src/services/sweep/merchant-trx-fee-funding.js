/**
 * Merchant TRON fee funding:
 * 1) Preferred / merchant TRX funder private key
 * 2) Else RP Swap main wallet — native TRX send to needy, or SunSwap USDT→TRX when needy is that main wallet
 */
import { Chain } from "@prisma/client";
import { utils as tronUtils } from "tronweb";
import { ACTIVE } from "../../lib/active-row.js";
import { logger } from "../../lib/logger.js";
import { getMerchantWalletMnemonic } from "../../lib/merchant-mnemonic.js";
import {
  getMerchantTrxSweepFunderPrivateKeyHex,
  normalizeTronPrivateKeyHex,
} from "../../lib/merchant-trx-funder.js";
import { getRpMerchantSwapMainTronAddress } from "../../lib/rp-merchant-swap-main.js";
import { prisma } from "../../lib/prisma.js";
import { deriveTronPrivateKeyHex } from "../wallet/tron-wallet.js";
import {
  sendTrxNativeTopUpFromPrivateKey,
  TRX_TOPUP_SEND_BUFFER_SUN,
  TRX_TOPUP_SETTLE_MS,
} from "./tron-trx-topup.js";
import { swapUsdtForTrxOnWallet } from "./tron-usdt-to-trx-sunswap.js";

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
 * @param {number} merchantId
 * @param {string} treasuryAddress
 * @returns {Promise<{ address: string, derivationIndex: number, privateKeyHex: string } | null>}
 */
async function resolveSignableTronUsdtWallet(merchantId, treasuryAddress) {
  const treasury = String(treasuryAddress ?? "").trim();
  if (!treasury) return null;
  try {
    tronUtils.address.toHex(treasury);
  } catch {
    return null;
  }

  const wallets = await prisma.wallet.findMany({
    where: {
      merchantId,
      chain: Chain.TRON,
      currency: "USDT",
      network: "TRC20",
      ...ACTIVE,
    },
    select: { address: true, derivationIndex: true, merchantId: true },
  });
  const wallet = wallets.find((w) => tronAddrEq(w.address, treasury)) ?? null;
  if (!wallet) return null;

  const mnemonic = await getMerchantWalletMnemonic(wallet.merchantId);
  const privateKeyHex = deriveTronPrivateKeyHex(wallet.derivationIndex, mnemonic);
  return {
    address: wallet.address,
    derivationIndex: wallet.derivationIndex,
    privateKeyHex,
  };
}

/**
 * Ensure `needyAddress` can cover `neededTrxSun` (one funding attempt).
 *
 * @param {{
 *   merchantId: number,
 *   needyAddress: string,
 *   neededTrxSun: bigint,
 *   currentTrxSun: bigint,
 *   needyPrivateKeyHex?: string | null,
 *   reserveUsdtAtomic?: bigint | null,
 *   preferredFunderPrivateKeyHex?: string | null,
 * }} p
 * @returns {Promise<
 *   | { ok: true, method: "funder" | "preferred_funder" | "treasury_send" | "treasury_sunswap" }
 *   | { ok: false, error: string, detail?: string }
 * >}
 */
export async function ensureTrxForMerchantWallet(p) {
  const merchantId = p.merchantId;
  const needy = String(p.needyAddress ?? "").trim();
  const needed = p.neededTrxSun;
  const current = p.currentTrxSun;

  if (!Number.isInteger(merchantId) || merchantId < 1) {
    return { ok: false, error: "invalid_merchant_id" };
  }
  if (!needy) {
    return { ok: false, error: "needy_address_required" };
  }
  if (typeof needed !== "bigint" || needed <= 0n) {
    return { ok: false, error: "invalid_needed_trx" };
  }
  if (typeof current !== "bigint") {
    return { ok: false, error: "invalid_current_trx" };
  }
  if (current >= needed) {
    return { ok: true, method: "funder" };
  }

  const gap = needed - current + TRX_TOPUP_SEND_BUFFER_SUN;

  if (p.preferredFunderPrivateKeyHex) {
    try {
      const preferredPk = normalizeTronPrivateKeyHex(p.preferredFunderPrivateKeyHex);
      const top = await sendTrxNativeTopUpFromPrivateKey(needy, gap, preferredPk);
      if (!top.ok) {
        return {
          ok: false,
          error: top.error,
          detail: top.detail ?? "Preferred TRX funder top-up failed",
        };
      }
      await new Promise((r) => setTimeout(r, TRX_TOPUP_SETTLE_MS));
      logger.info("merchant_trx_fee_funded", {
        event: "merchant_trx_fee_funded",
        method: "preferred_funder",
        merchant_id: merchantId,
        needy_address: needy,
        trx_sun: gap.toString(),
      });
      return { ok: true, method: "preferred_funder" };
    } catch (e) {
      return {
        ok: false,
        error: "preferred_funder_key_invalid",
        detail: String(e).slice(0, 300),
      };
    }
  }

  const funderPk = await getMerchantTrxSweepFunderPrivateKeyHex(merchantId);
  if (funderPk) {
    const top = await sendTrxNativeTopUpFromPrivateKey(needy, gap, funderPk);
    if (!top.ok) {
      return {
        ok: false,
        error: top.error,
        detail: top.detail ?? "TRX funder top-up failed",
      };
    }
    await new Promise((r) => setTimeout(r, TRX_TOPUP_SETTLE_MS));
    logger.info("merchant_trx_fee_funded", {
      event: "merchant_trx_fee_funded",
      method: "funder",
      merchant_id: merchantId,
      needy_address: needy,
      trx_sun: gap.toString(),
    });
    return { ok: true, method: "funder" };
  }

  const swapMain = await getRpMerchantSwapMainTronAddress(merchantId);
  const treasuryAddr = String(swapMain ?? "").trim();
  if (!treasuryAddr) {
    return {
      ok: false,
      error: "rp_swap_main_wallet_required",
      detail:
        "No TRX funder private key and no RP Swap main wallet. Set the merchant’s main wallet under RP → Swap first.",
    };
  }

  let treasuryWallet;
  try {
    treasuryWallet = await resolveSignableTronUsdtWallet(merchantId, treasuryAddr);
  } catch (e) {
    return {
      ok: false,
      error: "merchant_mnemonic_unavailable",
      detail: String(e).slice(0, 300),
    };
  }
  if (!treasuryWallet) {
    return {
      ok: false,
      error: "PAYOUT_TREASURY_NOT_SIGNABLE",
      detail:
        "Payout treasury must be one of this merchant’s gateway USDT·TRC20 deposit wallets so the gateway can sign TRX fee funding.",
    };
  }

  if (tronAddrEq(treasuryWallet.address, needy)) {
    const pk =
      typeof p.needyPrivateKeyHex === "string" && p.needyPrivateKeyHex.trim()
        ? p.needyPrivateKeyHex
        : treasuryWallet.privateKeyHex;
    const swap = await swapUsdtForTrxOnWallet({
      privateKeyHex: pk,
      fromAddress: needy,
      trxOutSun: gap,
      reserveUsdtAtomic: p.reserveUsdtAtomic ?? null,
    });
    if (!swap.ok) {
      return {
        ok: false,
        error: swap.error,
        detail: swap.detail,
      };
    }
    logger.info("merchant_trx_fee_funded", {
      event: "merchant_trx_fee_funded",
      method: "treasury_sunswap",
      merchant_id: merchantId,
      needy_address: needy,
      trx_sun: gap.toString(),
      usdt_in_atomic: swap.usdt_in_atomic,
      tx_hash: swap.tx_hash,
    });
    return { ok: true, method: "treasury_sunswap" };
  }

  const top = await sendTrxNativeTopUpFromPrivateKey(
    needy,
    gap,
    treasuryWallet.privateKeyHex,
  );
  if (!top.ok) {
    return {
      ok: false,
      error: top.error,
      detail:
        top.detail ??
        "Payout treasury did not have enough TRX to top up the deposit wallet. Fund the treasury with TRX or configure a TRX funder key.",
    };
  }
  await new Promise((r) => setTimeout(r, TRX_TOPUP_SETTLE_MS));
  logger.info("merchant_trx_fee_funded", {
    event: "merchant_trx_fee_funded",
    method: "treasury_send",
    merchant_id: merchantId,
    needy_address: needy,
    treasury_address: treasuryWallet.address,
    trx_sun: gap.toString(),
  });
  return { ok: true, method: "treasury_send" };
}
