import { Chain } from "@prisma/client";
import { TronWeb } from "tronweb";
import { utils as tronUtils } from "tronweb";
import { getTrc20Contracts } from "../../config/env.js";
import { getMerchantWalletMnemonic } from "../../lib/merchant-mnemonic.js";
import { resolveMerchantTronUsdtSweepFromSettings } from "../../lib/merchant-auto-swap-settings.js";
import { parseWalletDbId } from "../../lib/parse-wallet-db-id.js";
import { ACTIVE } from "../../lib/active-row.js";
import { prisma } from "../../lib/prisma.js";
import { logger } from "../../lib/logger.js";
import { acquireOutboundRpcSlot } from "../../lib/network-rpc-rate-limit.js";
import {
  getTronFullNodeBase,
  getTronProgApiKeyHeaders,
} from "../../lib/tron-node-client.js";
import { deriveTronPrivateKeyHex } from "../wallet/tron-wallet.js";
import { ensureTrxForMerchantWallet } from "./merchant-trx-fee-funding.js";

/** Minimal ERC20 ABI for balance + transfer (TRC20). TronWeb ≥6 expects `stateMutability` on each function. */
const TRC20_ABI = [
  {
    constant: true,
    inputs: [{ name: "_owner", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "balance", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    constant: false,
    inputs: [
      { name: "_to", type: "address" },
      { name: "_value", type: "uint256" },
    ],
    name: "transfer",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
];

/**
 * Buffer on top of on-chain fee math (pricing drift, bandwidth variance).
 * Not a fixed “minimum wallet balance” — see {@link estimateTrxSunRequiredForTrc20Transfer}.
 */
export const TRON_SWEEP_TRX_SAFETY_BUFFER_SUN = 500_000n;

/** If `estimateEnergy` fails, assume this many energy units (typical USDT·TRC20 transfer scale). */
const FALLBACK_TRC20_TRANSFER_ENERGY = 70_000n;

/** Bandwidth points (bytes) to plan for when sizing a TRC20 `transfer` tx. */
const TRC20_TRANSFER_BANDWIDTH_POINTS = 400n;

/** @param {unknown} raw */
function chainParamBigInt(raw) {
  if (raw == null) return null;
  try {
    const n = BigInt(String(raw).trim());
    return n >= 0n ? n : null;
  } catch {
    return null;
  }
}

/**
 * Approximate TRX (sun) the `owner` address must hold to burn fees for one TRC20 `transfer`
 * (energy + bandwidth shortfalls vs free/staked resources), plus {@link TRON_SWEEP_TRX_SAFETY_BUFFER_SUN}.
 *
 * @param {import("tronweb").TronWeb} tw
 * @param {string} ownerBase58
 * @param {string} contractBase58
 * @param {string} toBase58
 * @param {bigint} amountAtomic
 * @returns {Promise<bigint>}
 */
export async function estimateTrxSunRequiredForTrc20Transfer(
  tw,
  ownerBase58,
  contractBase58,
  toBase58,
  amountAtomic,
) {
  await acquireOutboundRpcSlot("TRON");
  let energyRequired = FALLBACK_TRC20_TRANSFER_ENERGY;
  try {
    const est = await tw.transactionBuilder.estimateEnergy(
      contractBase58,
      "transfer(address,uint256)",
      {},
      [
        { type: "address", value: toBase58 },
        { type: "uint256", value: amountAtomic.toString() },
      ],
      ownerBase58,
    );
    const er = est?.energy_required;
    if (er != null) {
      if (typeof er === "bigint" && er > 0n && er < 1_000_000_000n) {
        energyRequired = er;
      } else {
        const num = Number(typeof er === "string" ? er.trim() : er);
        if (Number.isFinite(num) && num > 0) {
          const n = BigInt(Math.ceil(num));
          if (n < 1_000_000_000n) {
            energyRequired = n;
          }
        }
      }
    }
  } catch (e) {
    logger.warn("tron_sweep_estimate_energy_failed", {
      event: "tron_sweep_estimate_energy_failed",
      at: new Date().toISOString(),
      owner: ownerBase58,
      err: String(e),
    });
  }

  let freeBwLeft = 0n;
  let stakeBwLeft = 0n;
  let energyLeft = 0n;
  try {
    await acquireOutboundRpcSlot("TRON");
    const res = await tw.trx.getAccountResources(ownerBase58);
    const freeNetLimit =
      chainParamBigInt(res?.freeNetLimit ?? res?.FreeNetLimit) ?? 600n;
    const freeNetUsed =
      chainParamBigInt(res?.freeNetUsed ?? res?.FreeNetUsed) ?? 0n;
    const netLimit = chainParamBigInt(res?.NetLimit ?? res?.netLimit) ?? 0n;
    const netUsed = chainParamBigInt(res?.NetUsed ?? res?.netUsed) ?? 0n;
    const energyLimit =
      chainParamBigInt(res?.EnergyLimit ?? res?.energyLimit) ?? 0n;
    const energyUsed =
      chainParamBigInt(res?.EnergyUsed ?? res?.energyUsed) ?? 0n;
    freeBwLeft = freeNetLimit > freeNetUsed ? freeNetLimit - freeNetUsed : 0n;
    stakeBwLeft = netLimit > netUsed ? netLimit - netUsed : 0n;
    energyLeft = energyLimit > energyUsed ? energyLimit - energyUsed : 0n;
  } catch (e) {
    logger.warn("tron_sweep_get_account_resources_failed", {
      event: "tron_sweep_get_account_resources_failed",
      at: new Date().toISOString(),
      owner: ownerBase58,
      err: String(e),
    });
  }

  let energyPriceSun = 420n;
  let bandwidthPriceSun = 1000n;
  try {
    await acquireOutboundRpcSlot("TRON");
    const chainParams = await tw.trx.getChainParameters();
    const paramBig = (key) => {
      const p = chainParams.find((x) => x.key === key);
      return chainParamBigInt(p?.value);
    };
    energyPriceSun = paramBig("getEnergyFee") ?? 420n;
    bandwidthPriceSun = paramBig("getTransactionFee") ?? 1000n;
  } catch (e) {
    logger.warn("tron_sweep_get_chain_parameters_failed", {
      event: "tron_sweep_get_chain_parameters_failed",
      at: new Date().toISOString(),
      err: String(e),
    });
  }

  const totalBwLeft = freeBwLeft + stakeBwLeft;
  const bwBurnPoints =
    TRC20_TRANSFER_BANDWIDTH_POINTS > totalBwLeft
      ? TRC20_TRANSFER_BANDWIDTH_POINTS - totalBwLeft
      : 0n;
  const bandwidthBurnSun = bwBurnPoints * bandwidthPriceSun;

  const energyShortfall =
    energyRequired > energyLeft ? energyRequired - energyLeft : 0n;
  const energyBurnSun = energyShortfall * energyPriceSun;

  return bandwidthBurnSun + energyBurnSun + TRON_SWEEP_TRX_SAFETY_BUFFER_SUN;
}

/** @param {string} privateKeyHex */
export function createTronWebFromPrivateKeyHex(privateKeyHex) {
  const pk = privateKeyHex.replace(/^0x/i, "");
  return new TronWeb({
    fullHost: getTronFullNodeBase(),
    headers: getTronProgApiKeyHeaders(),
    privateKey: pk,
  });
}

export function pickUsdtTrc20Contract() {
  const cfg = getTrc20Contracts();
  const hit = Object.entries(cfg).find(
    ([, m]) => String(m?.symbol ?? "").toUpperCase() === "USDT",
  );
  if (!hit) throw new Error("NO_USDT_TRC20_IN_CONFIG");
  return hit[0].trim();
}

/**
 * @param {unknown} raw
 * @returns {bigint}
 */
function rawBalanceToBigInt(raw) {
  if (typeof raw === "bigint") return raw;
  if (typeof raw === "number" && Number.isFinite(raw))
    return BigInt(Math.trunc(raw));
  if (raw && typeof raw === "object" && "_hex" in raw) {
    const h = /** @type {{ _hex: string }} */ (raw)._hex;
    return BigInt(h);
  }
  if (raw && typeof raw === "object" && typeof raw.toString === "function") {
    const s = String(raw.toString()).trim();
    if (/^\d+$/.test(s)) return BigInt(s);
  }
  const s = String(raw ?? "").trim();
  if (/^\d+$/.test(s)) return BigInt(s);
  if (/^0x[0-9a-f]+$/i.test(s)) return BigInt(s);
  throw new Error("UNEXPECTED_BALANCE_FORMAT");
}

/**
 * @returns {Promise<{ configured: boolean, master_tron_address: string | null, wallets: object[] }>}
 */
export async function listTronUsdtSweepTargets() {
  const wallets = await prisma.wallet.findMany({
    where: {
      /** Underlying L1 for USDT·TRC20 is always enum `TRON` (not the `network` label). */
      chain: Chain.TRON,
      currency: "USDT",
      network: "TRC20",
      ...ACTIVE,
    },
    orderBy: { createdAt: "asc" },
    include: {
      merchant: { select: { email: true, displayName: true } },
      assignedUser: { select: { externalUserId: true } },
    },
  });

  return {
    configured: true,
    master_tron_address: null,
    wallets: wallets.map((w) => ({
      id: w.id,
      address: w.address,
      chain: w.chain,
      currency: w.currency,
      network: w.network,
      derivation_index: w.derivationIndex,
      environment: w.environment,
      external_user_id: w.assignedUser?.externalUserId ?? null,
      merchant_label: w.merchant.displayName ?? w.merchant.email,
    })),
  };
}

/**
 * @param {string | number} walletId
 * @param {{ to_address?: string }} [opts] When `to_address` is set, send full USDT balance there. Otherwise send to the merchant’s USDT·TRC20 treasury from Gateway settings (no env master).
 * @returns {Promise<{ ok: true, skipped?: boolean, reason?: string, tx_hash?: string, amount_atomic?: string, from_address?: string, to_address?: string } | { ok: false, error: string, detail?: string }>}
 */
export async function sweepTronUsdtOne(walletId, opts = {}) {
  const wid = parseWalletDbId(walletId);
  if (wid == null) {
    return { ok: false, error: "WALLET_NOT_FOUND" };
  }

  const toOverride =
    typeof opts.to_address === "string" ? opts.to_address.trim() : "";

  if (toOverride) {
    try {
      tronUtils.address.toHex(toOverride);
    } catch {
      return {
        ok: false,
        error: "INVALID_TO_ADDRESS",
        detail: "to_address is not a valid TRON address",
      };
    }
  }

  let contractAddr;
  try {
    contractAddr = pickUsdtTrc20Contract();
  } catch (e) {
    return { ok: false, error: "CONFIG", detail: String(e) };
  }

  const wallet = await prisma.wallet.findFirst({
    where: {
      id: wid,
      chain: Chain.TRON,
      currency: "USDT",
      network: "TRC20",
      ...ACTIVE,
    },
  });

  if (!wallet) {
    return { ok: false, error: "WALLET_NOT_FOUND" };
  }

  let recipient;
  if (toOverride) {
    recipient = toOverride;
  } else {
    const dest = await resolveMerchantTronUsdtSweepFromSettings(wallet.merchantId);
    if (!dest.ok) {
      return {
        ok: false,
        error: dest.reason,
        detail: dest.message,
      };
    }
    recipient = dest.master;
  }

  if (tronAddrEq(wallet.address, recipient)) {
    return { ok: false, error: "SOURCE_IS_DESTINATION" };
  }

  const mnemonicPhrase = await getMerchantWalletMnemonic(wallet.merchantId);
  const pkHex = deriveTronPrivateKeyHex(wallet.derivationIndex, mnemonicPhrase);
  const tw = createTronWebFromPrivateKeyHex(pkHex);

  const fromHex = tronUtils.address.toHex(wallet.address);
  const derivedHex = tw.defaultAddress?.hex;
  if (typeof derivedHex !== "string") {
    logger.error("tron sweep: TronWeb defaultAddress.hex missing", {
      walletId,
    });
    return {
      ok: false,
      error: "TRONWEB_ADDRESS_NOT_READY",
      detail:
        "TronWeb did not set defaultAddress.hex after loading the wallet key",
    };
  }
  if (derivedHex.toLowerCase() !== fromHex.toLowerCase()) {
    logger.error("tron sweep: derived address mismatch", {
      walletId,
      expected: wallet.address,
      derived: tw.defaultAddress.base58,
    });
    return { ok: false, error: "DERIVED_ADDRESS_MISMATCH" };
  }

  return sweepTronUsdtTransferFullBalanceFromDepositWallet(
    wallet,
    recipient,
    contractAddr,
  );
}

/**
 * @returns {Promise<{ results: object[], summary: { attempted: number, ok: number, skipped: number, failed: number } }>}
 */
export async function sweepTronUsdtAll() {
  const { wallets, configured } = await listTronUsdtSweepTargets();
  if (!configured) {
    return {
      configured: false,
      results: [],
      summary: { attempted: 0, ok: 0, skipped: 0, failed: 0 },
    };
  }

  const results = [];
  let ok = 0;
  let skipped = 0;
  let failed = 0;

  for (const w of wallets) {
    const r = await sweepTronUsdtOne(w.id);
    if (r.ok) {
      if (r.skipped) {
        skipped += 1;
        results.push({
          wallet_id: w.id,
          status: "skipped",
          reason: r.reason,
          ...(r.from_address ? { from_address: r.from_address } : {}),
          ...(r.balance_atomic != null
            ? { balance_atomic: String(r.balance_atomic) }
            : {}),
          ...(r.detail ? { detail: r.detail } : {}),
        });
      } else {
        ok += 1;
        results.push({
          wallet_id: w.id,
          status: "swept",
          tx_hash: r.tx_hash,
          amount_atomic: r.amount_atomic,
        });
      }
    } else {
      failed += 1;
      results.push({
        wallet_id: w.id,
        status: "failed",
        error: r.error,
        detail: r.detail,
      });
    }
  }

  return {
    configured: true,
    results,
    summary: {
      attempted: wallets.length,
      ok,
      skipped,
      failed,
    },
  };
}

/**
 * @param {{ address: string, derivationIndex: number, merchantId: number }} wallet
 * @param {string} contractAddr
 * @returns {Promise<bigint>}
 */
export async function readTronUsdtBalanceAtomicForWallet(wallet, contractAddr) {
  const mnemonicPhrase = await getMerchantWalletMnemonic(wallet.merchantId);
  const pkHex = deriveTronPrivateKeyHex(wallet.derivationIndex, mnemonicPhrase);
  const tw = createTronWebFromPrivateKeyHex(pkHex);
  const contract = tw.contract(TRC20_ABI, contractAddr);
  await acquireOutboundRpcSlot("TRON");
  const balRaw = await contract.balanceOf(wallet.address).call();
  return rawBalanceToBigInt(balRaw);
}

/**
 * Full USDT·TRC20 balance from deposit wallet → recipient (sweep master or admin override).
 * TRX requirement is computed dynamically ({@link estimateTrxSunRequiredForTrc20Transfer}).
 *
 * @param {{ id: string, address: string, derivationIndex: number, merchantId: number }} wallet
 * @param {string} recipient Base58 TRON receive address (historically sweep master; may be any valid recipient).
 * @param {string} contractAddr
 */
export async function sweepTronUsdtTransferFullBalanceFromDepositWallet(
  wallet,
  recipient,
  contractAddr,
) {
  const mnemonicPhrase = await getMerchantWalletMnemonic(wallet.merchantId);
  const pkHex = deriveTronPrivateKeyHex(wallet.derivationIndex, mnemonicPhrase);
  const tw = createTronWebFromPrivateKeyHex(pkHex);

  const fromHex = tronUtils.address.toHex(wallet.address);
  const derivedHex = tw.defaultAddress?.hex;
  if (typeof derivedHex !== "string") {
    logger.error("tron sweep transfer: TronWeb defaultAddress.hex missing", {
      walletId: wallet.id,
    });
    return {
      ok: false,
      error: "TRONWEB_ADDRESS_NOT_READY",
      detail: "TronWeb did not set defaultAddress.hex",
    };
  }
  if (derivedHex.toLowerCase() !== fromHex.toLowerCase()) {
    logger.error("tron sweep transfer: derived address mismatch", {
      walletId: wallet.id,
    });
    return { ok: false, error: "DERIVED_ADDRESS_MISMATCH" };
  }

  const contract = tw.contract(TRC20_ABI, contractAddr);
  await acquireOutboundRpcSlot("TRON");
  const balRaw = await contract.balanceOf(wallet.address).call();
  const amount = rawBalanceToBigInt(balRaw);
  if (amount <= 0n) {
    return {
      ok: true,
      skipped: true,
      reason: "zero_usdt_balance",
      balance_atomic: amount.toString(),
    };
  }

  let neededTrxSun = await estimateTrxSunRequiredForTrc20Transfer(
    tw,
    wallet.address,
    contractAddr,
    recipient,
    amount,
  );

  await acquireOutboundRpcSlot("TRON");
  let trxSun = BigInt(await tw.trx.getBalance(wallet.address));

  for (let attempt = 0; trxSun < neededTrxSun && attempt < 4; attempt += 1) {
    const funded = await ensureTrxForMerchantWallet({
      merchantId: wallet.merchantId,
      needyAddress: wallet.address,
      neededTrxSun,
      currentTrxSun: trxSun,
      needyPrivateKeyHex: pkHex,
      reserveUsdtAtomic: null,
    });
    if (!funded.ok) {
      return {
        ok: false,
        error:
          funded.error === "TRX_FUNDER_REQUIRED"
            ? "MERCHANT_TRX_FUNDER_KEY_REQUIRED"
            : funded.error,
        detail:
          funded.detail ??
          "This deposit wallet needs more TRX for network fees. Save a TRX funder key under Gateway & webhooks, or set a USDT·TRC20 payout treasury with TRX.",
      };
    }
    await acquireOutboundRpcSlot("TRON");
    trxSun = BigInt(await tw.trx.getBalance(wallet.address));
    neededTrxSun = await estimateTrxSunRequiredForTrc20Transfer(
      tw,
      wallet.address,
      contractAddr,
      recipient,
      amount,
    );
  }

  if (trxSun < neededTrxSun) {
    return {
      ok: false,
      error: "INSUFFICIENT_TRX_FOR_FEE",
      detail: `Need ~${neededTrxSun} sun (estimated for fees); have ${trxSun} after top-up attempts`,
    };
  }

  await acquireOutboundRpcSlot("TRON");
  let txId;
  try {
    txId = await contract.transfer(recipient, amount.toString()).send({
      feeLimit: 150_000_000,
      shouldPollResponse: true,
    });
  } catch (e) {
    logger.error("tron sweep transfer failed", {
      walletId: wallet.id,
      err: String(e),
    });
    return { ok: false, error: "TRANSFER_FAILED", detail: String(e) };
  }

  logger.info("tron usdt swept", {
    walletId: wallet.id,
    from: wallet.address,
    to: recipient,
    amount: amount.toString(),
    tx: txId,
  });

  return {
    ok: true,
    tx_hash: typeof txId === "string" ? txId : String(txId),
    amount_atomic: amount.toString(),
    from_address: wallet.address,
    to_address: recipient,
  };
}

/**
 * @param {string} a
 * @param {string} b
 */
function tronAddrEq(a, b) {
  try {
    return tronUtils.address.toHex(a) === tronUtils.address.toHex(b);
  } catch {
    return a === b;
  }
}
