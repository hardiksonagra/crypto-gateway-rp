import { Chain } from "@prisma/client";
import { re } from "../../config/runtime-env.js";
import {
  resolveMerchantRailSweepFromSettings,
  USDT_ERC20_RAIL_KEY,
  USDT_TRC20_RAIL_KEY,
} from "../../lib/merchant-auto-swap-settings.js";
import { parseWalletDbId } from "../../lib/parse-wallet-db-id.js";
import { ACTIVE } from "../../lib/active-row.js";
import { prisma } from "../../lib/prisma.js";
import {
  pickUsdtTokenAddress,
  sweepEvmUsdtAll,
  sweepEvmUsdtOne,
} from "./evm-usdt-sweep.js";
import { sweepTronUsdtAll, sweepTronUsdtOne } from "./tron-usdt-sweep.js";

/** @typedef {"tron_usdt"|"evm_usdt_eth"} SweepKind */

/**
 * @param {{ chain: import("@prisma/client").Chain, currency: string, network: string }} w
 * @returns {SweepKind | null}
 */
export function sweepKindForWallet(w) {
  const { chain, currency, network } = w;
  if (chain === Chain.TRON && currency === "USDT" && network === "TRC20") return "tron_usdt";
  if (chain === Chain.ETH && currency === "USDT" && network === "ERC20") return "evm_usdt_eth";
  return null;
}

const sweepWalletInclude = {
  merchant: { select: { email: true, displayName: true } },
  assignedUser: { select: { externalUserId: true } },
};

/**
 * @returns {Promise<{ wallets: object[], total: number, gateway_tron_usdt_only: boolean }>}
 */
export async function listUnifiedSweepTargets() {
  const rows = await prisma.wallet.findMany({
    where: {
      ...ACTIVE,
      OR: [
        { chain: Chain.TRON, currency: "USDT", network: "TRC20" },
        { chain: Chain.ETH, currency: "USDT", network: "ERC20" },
      ],
    },
    orderBy: { createdAt: "asc" },
    include: sweepWalletInclude,
  });

  const wallets = [];
  for (const w of rows) {
    const kind = sweepKindForWallet(w);
    let cfg = null;
    if (kind === "tron_usdt") {
      const r = await resolveMerchantRailSweepFromSettings(w.merchantId, USDT_TRC20_RAIL_KEY);
      cfg = {
        configured: r.ok,
        destination_address: r.ok ? r.master : null,
        master_env: "merchant_gateway_auto_swap",
      };
    } else if (kind === "evm_usdt_eth") {
      const r = await resolveMerchantRailSweepFromSettings(w.merchantId, USDT_ERC20_RAIL_KEY);
      cfg = {
        configured: r.ok,
        destination_address: r.ok ? r.master : null,
        master_env: "merchant_gateway_auto_swap",
        usdt_contract: pickUsdtTokenAddress(Chain.ETH),
      };
    }
    wallets.push({
      id: w.id,
      address: w.address,
      chain: w.chain,
      currency: w.currency,
      network: w.network,
      derivation_index: w.derivationIndex,
      environment: w.environment,
      external_user_id: w.assignedUser?.externalUserId ?? null,
      merchant_label: w.merchant.displayName ?? w.merchant.email,
      sweep_kind: kind,
      sweep_label: kind ? sweepKindLabel(kind) : null,
      sweep_configured: cfg?.configured ?? false,
      destination_address: cfg?.destination_address ?? null,
      master_env: cfg?.master_env ?? null,
      ...(cfg?.usdt_contract ? { usdt_contract: cfg.usdt_contract } : {}),
    });
  }

  return {
    wallets,
    total: wallets.length,
    gateway_tron_usdt_only: re.gatewayTronUsdtOnly,
  };
}

/**
 * @param {SweepKind} kind
 */
function sweepKindLabel(kind) {
  switch (kind) {
    case "tron_usdt":
      return "USDT · TRC20";
    case "evm_usdt_eth":
      return "USDT · ERC20";
    default:
      return kind;
  }
}

/**
 * @param {string | number} walletId
 */
export async function sweepUnifiedOne(walletId) {
  const wid = parseWalletDbId(walletId);
  if (wid == null) {
    return { ok: false, error: "WALLET_NOT_FOUND" };
  }
  const wallet = await prisma.wallet.findFirst({
    where: { id: wid, ...ACTIVE },
    select: { id: true, chain: true, currency: true, network: true, merchantId: true },
  });

  if (!wallet) {
    return { ok: false, error: "WALLET_NOT_FOUND" };
  }

  const kind = sweepKindForWallet(wallet);
  if (!kind) {
    return { ok: false, error: "NOT_SWEEPABLE" };
  }

  let sweepOk = false;
  if (kind === "tron_usdt") {
    const r = await resolveMerchantRailSweepFromSettings(wallet.merchantId, USDT_TRC20_RAIL_KEY);
    sweepOk = r.ok;
  } else if (kind === "evm_usdt_eth") {
    const r = await resolveMerchantRailSweepFromSettings(wallet.merchantId, USDT_ERC20_RAIL_KEY);
    sweepOk = r.ok;
  }
  if (!sweepOk) {
    return {
      ok: false,
      error: "SWEEP_NOT_CONFIGURED",
      sweep_kind: kind,
      master_env: "merchant_gateway_auto_swap",
    };
  }

  let inner;
  switch (kind) {
    case "tron_usdt":
      inner = await sweepTronUsdtOne(wid);
      break;
    case "evm_usdt_eth":
      inner = await sweepEvmUsdtOne(wid, Chain.ETH);
      break;
    default:
      return { ok: false, error: "NOT_SWEEPABLE" };
  }
  return {
    ...inner,
    sweep_kind: kind,
    sweep_label: sweepKindLabel(kind),
  };
}

/**
 * Runs each per-rail sweep-all sequentially (reuses existing sweep logic + rate limits).
 */
export async function sweepUnifiedAll() {
  /** @type {object[]} */
  const results = [];
  /** @type {{ attempted: number, ok: number, skipped: number, failed: number }} */
  const summary = { attempted: 0, ok: 0, skipped: 0, failed: 0 };
  /** @type {object[]} */
  const unconfigured = [];

  /**
   * @param {SweepKind} kind
   * @param {Promise<{ configured?: boolean, results?: object[], summary?: { attempted: number, ok: number, skipped: number, failed: number } }>} p
   */
  async function ingest(kind, p) {
    const batch = await p;
    if (!batch.configured) {
      unconfigured.push({
        sweep_kind: kind,
        sweep_label: sweepKindLabel(kind),
        master_env: "merchant_gateway_auto_swap",
      });
      return;
    }
    const rows = batch.results ?? [];
    for (const r of rows) {
      results.push({ ...r, sweep_kind: kind, sweep_label: sweepKindLabel(kind) });
    }
    const s = batch.summary;
    if (s) {
      summary.attempted += s.attempted;
      summary.ok += s.ok;
      summary.skipped += s.skipped;
      summary.failed += s.failed;
    }
  }

  await ingest("tron_usdt", sweepTronUsdtAll());
  if (!re.gatewayTronUsdtOnly) {
    await ingest("evm_usdt_eth", sweepEvmUsdtAll(Chain.ETH));
  }

  return { results, summary, unconfigured };
}
