import { Chain } from "@prisma/client";
import { TronWeb } from "tronweb";
import { utils as tronUtils } from "tronweb";
import { env, getTrc20Contracts } from "../../config/env.js";
import { re } from "../../config/runtime-env.js";
import { prisma } from "../../lib/prisma.js";
import { logger } from "../../lib/logger.js";
import { acquireOutboundRpcSlot } from "../../lib/network-rpc-rate-limit.js";
import { deriveTronPrivateKeyHex } from "../wallet/tron-wallet.js";

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

/** Rough minimum TRX (sun) so a TRC20 transfer can burn bandwidth/energy. */
export const MIN_TRX_SUN_FOR_SWEEP = 12_000_000n;

function tronHost() {
  return re.tronFullNode.replace(/\/$/, "");
}

function tronHeaders() {
  return re.tronApiKey ? { "TRON-PRO-API-KEY": re.tronApiKey } : {};
}

/** @param {string} privateKeyHex */
export function createTronWebFromPrivateKeyHex(privateKeyHex) {
  const pk = privateKeyHex.replace(/^0x/i, "");
  return new TronWeb({
    fullHost: tronHost(),
    headers: tronHeaders(),
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
  if (typeof raw === "number" && Number.isFinite(raw)) return BigInt(Math.trunc(raw));
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
  const master = re.sweepMasterTron?.trim() ?? "";

  const wallets = await prisma.wallet.findMany({
    where: {
      /** Underlying L1 for USDT·TRC20 is always enum `TRON` (not the `network` label). */
      chain: Chain.TRON,
      currency: "USDT",
      network: "TRC20",
    },
    orderBy: { createdAt: "asc" },
    include: {
      merchant: { select: { email: true, displayName: true } },
      assignedUser: { select: { externalUserId: true } },
    },
  });

  return {
    configured: Boolean(master),
    master_tron_address: master || null,
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
 * @param {string} walletId
 * @returns {Promise<{ ok: true, skipped?: boolean, reason?: string, tx_hash?: string, amount_atomic?: string, from_address?: string, to_address?: string } | { ok: false, error: string, detail?: string }>}
 */
export async function sweepTronUsdtOne(walletId) {
  const master = re.sweepMasterTron?.trim();
  if (!master) {
    return { ok: false, error: "SWEEP_MASTER_TRON_NOT_SET" };
  }

  let contractAddr;
  try {
    contractAddr = pickUsdtTrc20Contract();
  } catch (e) {
    return { ok: false, error: "CONFIG", detail: String(e) };
  }

  const wallet = await prisma.wallet.findFirst({
    where: {
      id: walletId,
      chain: Chain.TRON,
      currency: "USDT",
      network: "TRC20",
    },
  });

  if (!wallet) {
    return { ok: false, error: "WALLET_NOT_FOUND" };
  }

  if (tronAddrEq(wallet.address, master)) {
    return { ok: false, error: "SOURCE_IS_MASTER" };
  }

  const pkHex = deriveTronPrivateKeyHex(wallet.derivationIndex, env.mnemonic);
  const tw = createTronWebFromPrivateKeyHex(pkHex);

  const fromHex = tronUtils.address.toHex(wallet.address);
  const derivedHex = tw.defaultAddress?.hex;
  if (typeof derivedHex !== "string") {
    logger.error("tron sweep: TronWeb defaultAddress.hex missing", { walletId });
    return {
      ok: false,
      error: "TRONWEB_ADDRESS_NOT_READY",
      detail: "TronWeb did not set defaultAddress.hex after loading the wallet key",
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
    master,
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
          ...(r.balance_atomic != null ? { balance_atomic: String(r.balance_atomic) } : {}),
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
 * @param {{ address: string, derivationIndex: number }} wallet
 * @param {string} contractAddr
 * @returns {Promise<bigint>}
 */
export async function readTronUsdtBalanceAtomicForWallet(wallet, contractAddr) {
  const pkHex = deriveTronPrivateKeyHex(wallet.derivationIndex, env.mnemonic);
  const tw = createTronWebFromPrivateKeyHex(pkHex);
  const contract = tw.contract(TRC20_ABI, contractAddr);
  await acquireOutboundRpcSlot("TRON");
  const balRaw = await contract.balanceOf(wallet.address).call();
  return rawBalanceToBigInt(balRaw);
}

/**
 * Full USDT·TRC20 balance from deposit wallet → master (caller must ensure TRX ≥ {@link MIN_TRX_SUN_FOR_SWEEP}).
 *
 * @param {{ id: string, address: string, derivationIndex: number }} wallet
 * @param {string} master
 * @param {string} contractAddr
 */
export async function sweepTronUsdtTransferFullBalanceFromDepositWallet(
  wallet,
  master,
  contractAddr,
) {
  const pkHex = deriveTronPrivateKeyHex(wallet.derivationIndex, env.mnemonic);
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

  await acquireOutboundRpcSlot("TRON");
  const trxSun = BigInt(await tw.trx.getBalance(wallet.address));
  if (trxSun < MIN_TRX_SUN_FOR_SWEEP) {
    return {
      ok: false,
      error: "INSUFFICIENT_TRX_FOR_FEE",
      detail: `Need at least ${MIN_TRX_SUN_FOR_SWEEP} sun; have ${trxSun}`,
    };
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

  await acquireOutboundRpcSlot("TRON");
  let txId;
  try {
    txId = await contract.transfer(master, amount.toString()).send({
      feeLimit: 150_000_000,
      shouldPollResponse: true,
    });
  } catch (e) {
    logger.error("tron sweep transfer failed", { walletId: wallet.id, err: String(e) });
    return { ok: false, error: "TRANSFER_FAILED", detail: String(e) };
  }

  logger.info("tron usdt swept", {
    walletId: wallet.id,
    from: wallet.address,
    to: master,
    amount: amount.toString(),
    tx: txId,
  });

  return {
    ok: true,
    tx_hash: typeof txId === "string" ? txId : String(txId),
    amount_atomic: amount.toString(),
    from_address: wallet.address,
    to_address: master,
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
