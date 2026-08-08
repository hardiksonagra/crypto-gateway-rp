import { Chain } from "@prisma/client";
import { HDNodeWallet, Wallet as EthersWallet, ethers } from "ethers";
import { utils as tronUtils } from "tronweb";
import { env } from "../../config/env.js";
import { re } from "../../config/runtime-env.js";
import { ACTIVE } from "../../lib/active-row.js";
import {
  normalizeTronPrivateKeyHex,
  tronAddressFromPrivateKeyHex,
} from "../../lib/merchant-trx-funder.js";
import { getMerchantWalletMnemonic } from "../../lib/merchant-mnemonic.js";
import { prisma } from "../../lib/prisma.js";
import { deriveTronPrivateKeyHex } from "../wallet/tron-wallet.js";

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
 * Platform hot-wallet private key for a payout rail (Admin / `.env`).
 *
 * @param {Chain} chain
 * @returns {{ ok: true, privateKeyHex: string, address: string } | { ok: false, error: string }}
 */
export function platformPayoutHotSigner(chain) {
  if (chain === Chain.TRON) {
    const raw = re.payoutHotPrivateKeyTron || env.payoutHotPrivateKeyTron || "";
    if (!String(raw).trim()) {
      return { ok: false, error: "payout_hot_wallet_not_configured" };
    }
    try {
      const privateKeyHex = normalizeTronPrivateKeyHex(raw);
      const address = tronAddressFromPrivateKeyHex(privateKeyHex);
      return { ok: true, privateKeyHex, address };
    } catch {
      return { ok: false, error: "payout_hot_wallet_key_invalid" };
    }
  }
  if (chain === Chain.ETH) {
    const raw = re.payoutHotPrivateKeyEth || env.payoutHotPrivateKeyEth || "";
    if (!String(raw).trim()) {
      return { ok: false, error: "payout_hot_wallet_not_configured" };
    }
    try {
      const pk = String(raw).trim();
      const w = new EthersWallet(pk.startsWith("0x") ? pk : `0x${pk}`);
      return {
        ok: true,
        privateKeyHex: w.privateKey,
        address: w.address,
      };
    } catch {
      return { ok: false, error: "payout_hot_wallet_key_invalid" };
    }
  }
  return { ok: false, error: "unsupported_payout_chain" };
}

/**
 * Resolve who signs the on-chain USDT send for a payout.
 *
 * - Treasury address set → that address (must be platform hot wallet **or** a merchant HD deposit wallet).
 * - Treasury empty → platform hot wallet.
 *
 * @param {{
 *   merchantId: number,
 *   chain: Chain,
 *   treasuryAddress: string,
 * }} p
 * @returns {Promise<
 *   | {
 *       ok: true,
 *       privateKeyHex: string,
 *       fromAddress: string,
 *       source: "platform_hot" | "merchant_wallet",
 *       merchantIdForTrxTopup: number | null,
 *       allowPlatformTrxFunder: boolean,
 *     }
 *   | { ok: false, error: string, message: string }
 * >}
 */
export async function resolvePayoutSigner(p) {
  const treasury = String(p.treasuryAddress ?? "").trim();
  const hot = platformPayoutHotSigner(p.chain);

  if (!treasury) {
    if (!hot.ok) {
      return {
        ok: false,
        error: hot.error,
        message:
          "No payout treasury address set and platform hot wallet private key is missing. Set Payout treasury in merchant settings, or configure PAYOUT_HOT_PRIVATE_KEY_TRON / PAYOUT_HOT_PRIVATE_KEY_ETH.",
      };
    }
    return {
      ok: true,
      privateKeyHex: hot.privateKeyHex,
      fromAddress: hot.address,
      source: "platform_hot",
      merchantIdForTrxTopup: null,
      allowPlatformTrxFunder: true,
    };
  }

  if (p.chain === Chain.TRON) {
    try {
      tronUtils.address.toHex(treasury);
    } catch {
      return {
        ok: false,
        error: "invalid_payout_treasury",
        message: "Payout treasury address is not a valid TRON address.",
      };
    }
    if (hot.ok && tronAddrEq(hot.address, treasury)) {
      return {
        ok: true,
        privateKeyHex: hot.privateKeyHex,
        fromAddress: hot.address,
        source: "platform_hot",
        merchantIdForTrxTopup: null,
        allowPlatformTrxFunder: true,
      };
    }
  } else if (p.chain === Chain.ETH) {
    let treNorm;
    try {
      treNorm = ethers.getAddress(treasury);
    } catch {
      return {
        ok: false,
        error: "invalid_payout_treasury",
        message: "Payout treasury address is not a valid Ethereum address.",
      };
    }
    if (hot.ok && hot.address.toLowerCase() === treNorm.toLowerCase()) {
      return {
        ok: true,
        privateKeyHex: hot.privateKeyHex,
        fromAddress: hot.address,
        source: "platform_hot",
        merchantIdForTrxTopup: null,
        allowPlatformTrxFunder: false,
      };
    }
  } else {
    return {
      ok: false,
      error: "unsupported_payout_chain",
      message: "Unsupported payout chain.",
    };
  }

  const wallets = await prisma.wallet.findMany({
    where: {
      merchantId: p.merchantId,
      chain: p.chain,
      currency: "USDT",
      network: p.chain === Chain.TRON ? "TRC20" : "ERC20",
      ...ACTIVE,
    },
    select: { id: true, address: true, derivationIndex: true, merchantId: true },
  });

  const wallet =
    p.chain === Chain.TRON
      ? wallets.find((w) => tronAddrEq(w.address, treasury)) ?? null
      : wallets.find(
          (w) => w.address.toLowerCase() === ethers.getAddress(treasury).toLowerCase(),
        ) ?? null;

  if (!wallet) {
    return {
      ok: false,
      error: "payout_treasury_not_signable",
      message:
        "Payout treasury must be the platform hot wallet address or one of this merchant’s gateway USDT deposit wallets (so the gateway can sign).",
    };
  }

  try {
    const mnemonic = await getMerchantWalletMnemonic(wallet.merchantId);
    if (p.chain === Chain.TRON) {
      const privateKeyHex = deriveTronPrivateKeyHex(wallet.derivationIndex, mnemonic);
      return {
        ok: true,
        privateKeyHex,
        fromAddress: wallet.address,
        source: "merchant_wallet",
        merchantIdForTrxTopup: wallet.merchantId,
        allowPlatformTrxFunder: false,
      };
    }
    const path = `m/44'/60'/0'/0/${wallet.derivationIndex}`;
    const derived = HDNodeWallet.fromPhrase(mnemonic, undefined, path);
    if (derived.address.toLowerCase() !== wallet.address.toLowerCase()) {
      return {
        ok: false,
        error: "derived_address_mismatch",
        message: "Merchant wallet key derivation did not match the treasury address.",
      };
    }
    return {
      ok: true,
      privateKeyHex: derived.privateKey,
      fromAddress: wallet.address,
      source: "merchant_wallet",
      merchantIdForTrxTopup: null,
      allowPlatformTrxFunder: false,
    };
  } catch (e) {
    return {
      ok: false,
      error: "merchant_mnemonic_unavailable",
      message: String(e).slice(0, 300),
    };
  }
}
