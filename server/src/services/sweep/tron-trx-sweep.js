import { Chain } from "@prisma/client";
import { TronWeb } from "tronweb";
import { utils as tronUtils } from "tronweb";
import { env } from "../../config/env.js";
import { re } from "../../config/runtime-env.js";
import { prisma } from "../../lib/prisma.js";
import { logger } from "../../lib/logger.js";
import { acquireOutboundRpcSlot } from "../../lib/network-rpc-rate-limit.js";
import {
  getTronFullNodeBase,
  getTronProgApiKeyHeaders,
} from "../../lib/tron-node-client.js";
import { deriveTronPrivateKeyHex } from "../wallet/tron-wallet.js";

/** Keep this much TRX (sun) on the deposit account after sweep for future fees / rent. */
const TRX_RESERVE_SUN = 2_000_000;

function createTronWeb(privateKeyHex) {
  const pk = privateKeyHex.replace(/^0x/i, "");
  return new TronWeb({
    fullHost: getTronFullNodeBase(),
    headers: getTronProgApiKeyHeaders(),
    privateKey: pk,
  });
}

/** Master for native TRX; falls back to USDT TRC20 master (same T address is common). */
function masterTrxAddress() {
  const a = re.sweepMasterTrx?.trim();
  if (a) return a;
  return re.sweepMasterTron?.trim() ?? "";
}

function tronAddrEq(a, b) {
  try {
    return tronUtils.address.toHex(a) === tronUtils.address.toHex(b);
  } catch {
    return a === b;
  }
}

/**
 * @returns {Promise<{ configured: boolean, master_trx_address: string | null, wallets: object[] }>}
 */
export async function listTronTrxSweepTargets() {
  const master = masterTrxAddress();

  const wallets = await prisma.wallet.findMany({
    where: {
      chain: Chain.TRON,
      currency: "TRX",
      network: "TRON",
    },
    orderBy: { createdAt: "asc" },
    include: {
      merchant: { select: { email: true, displayName: true } },
      assignedUser: { select: { externalUserId: true } },
    },
  });

  return {
    configured: Boolean(master),
    master_trx_address: master || null,
    uses_tron_usdt_master_fallback: Boolean(!re.sweepMasterTrx?.trim() && master),
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
 */
export async function sweepTronTrxOne(walletId) {
  const master = masterTrxAddress();
  if (!master) {
    return { ok: false, error: "SWEEP_MASTER_TRX_OR_TRON_NOT_SET" };
  }

  const wallet = await prisma.wallet.findFirst({
    where: {
      id: walletId,
      chain: Chain.TRON,
      currency: "TRX",
      network: "TRON",
    },
  });

  if (!wallet) {
    return { ok: false, error: "WALLET_NOT_FOUND" };
  }

  if (tronAddrEq(wallet.address, master)) {
    return { ok: false, error: "SOURCE_IS_MASTER" };
  }

  const pkHex = deriveTronPrivateKeyHex(wallet.derivationIndex, env.mnemonic);
  const tw = createTronWeb(pkHex);

  const fromHex = tronUtils.address.toHex(wallet.address);
  if (tw.defaultAddress.hex.toLowerCase() !== fromHex.toLowerCase()) {
    logger.error("tron trx sweep: derived address mismatch", {
      walletId,
      expected: wallet.address,
      derived: tw.defaultAddress.base58,
    });
    return { ok: false, error: "DERIVED_ADDRESS_MISMATCH" };
  }

  await acquireOutboundRpcSlot("TRON");
  const balSun = BigInt(await tw.trx.getBalance(wallet.address));
  const reserve = BigInt(TRX_RESERVE_SUN);
  if (balSun <= reserve) {
    return {
      ok: true,
      skipped: true,
      reason: "insufficient_trx_above_reserve",
      from_address: wallet.address,
      balance_atomic: balSun.toString(),
      detail: `Balance ${balSun.toString()} sun; need more than ${TRX_RESERVE_SUN} sun to sweep`,
    };
  }

  const sendSun = balSun - reserve;
  if (sendSun > BigInt(Number.MAX_SAFE_INTEGER)) {
    return {
      ok: false,
      error: "AMOUNT_TOO_LARGE",
      detail: "TRX balance exceeds safe JavaScript integer for this transfer path",
    };
  }

  let tx;
  try {
    await acquireOutboundRpcSlot("TRON");
    const built = await tw.transactionBuilder.sendTrx(
      master,
      Number(sendSun),
      wallet.address,
    );
    const signed = await tw.trx.sign(built, pkHex);
    await acquireOutboundRpcSlot("TRON");
    tx = await tw.trx.sendRawTransaction(signed);
  } catch (e) {
    logger.error("tron trx sweep failed", { walletId, err: String(e) });
    return { ok: false, error: "TRANSFER_FAILED", detail: String(e) };
  }

  const txid = tx?.txid ?? tx?.transaction?.txID;
  logger.info("tron trx swept", {
    walletId,
    from: wallet.address,
    to: master,
    sun: sendSun.toString(),
    txid,
  });

  return {
    ok: true,
    tx_hash: typeof txid === "string" ? txid : String(txid ?? ""),
    amount_atomic: sendSun.toString(),
    from_address: wallet.address,
    to_address: master,
  };
}

export async function sweepTronTrxAll() {
  const { wallets, configured } = await listTronTrxSweepTargets();
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
    const r = await sweepTronTrxOne(w.id);
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
