import { Chain } from "@prisma/client";
import { re } from "../../config/runtime-env.js";
import { prisma } from "../../lib/prisma.js";
import { postgresChainEnumHasSolana } from "../../lib/postgres-chain-enum-solana.js";
import {
  pickUsdtTokenAddress,
  sweepEvmUsdtAll,
  sweepEvmUsdtOne,
} from "./evm-usdt-sweep.js";
import { sweepSolanaUsdtAll, sweepSolanaUsdtOne } from "./solana-usdt-sweep.js";
import { sweepTronTrxAll, sweepTronTrxOne } from "./tron-trx-sweep.js";
import { sweepTronUsdtAll, sweepTronUsdtOne } from "./tron-usdt-sweep.js";

/** @typedef {"tron_usdt"|"tron_trx"|"evm_usdt_eth"|"evm_usdt_bnb"|"solana_usdt"} SweepKind */

/**
 * @param {{ chain: import("@prisma/client").Chain, currency: string, network: string }} w
 * @returns {SweepKind | null}
 */
export function sweepKindForWallet(w) {
  const { chain, currency, network } = w;
  if (chain === Chain.TRON && currency === "USDT" && network === "TRC20") return "tron_usdt";
  if (chain === Chain.TRON && currency === "TRX" && network === "TRON") return "tron_trx";
  if (chain === Chain.ETH && currency === "USDT" && network === "ERC20") return "evm_usdt_eth";
  if (chain === Chain.BNB && currency === "USDT" && network === "BEP20") return "evm_usdt_bnb";
  if (chain === Chain.SOLANA && currency === "USDT" && network === "SPL") return "solana_usdt";
  return null;
}

function tronTrxDestination() {
  const trx = re.sweepMasterTrx?.trim();
  if (trx) return trx;
  return re.sweepMasterTron?.trim() ?? "";
}

/**
 * @param {SweepKind} kind
 */
function sweepConfiguration(kind) {
  switch (kind) {
    case "tron_usdt": {
      const m = re.sweepMasterTron?.trim() ?? "";
      return {
        configured: Boolean(m),
        destination_address: m || null,
        master_env: "SWEEP_MASTER_TRON",
      };
    }
    case "tron_trx": {
      const m = tronTrxDestination();
      return {
        configured: Boolean(m),
        destination_address: m || null,
        master_env: re.sweepMasterTrx?.trim() ? "SWEEP_MASTER_TRX" : "SWEEP_MASTER_TRON",
        uses_tron_usdt_master_fallback: Boolean(!re.sweepMasterTrx?.trim() && m),
      };
    }
    case "evm_usdt_eth": {
      const m = re.sweepMasterUsdtEth?.trim() ?? "";
      return {
        configured: Boolean(m),
        destination_address: m || null,
        master_env: "SWEEP_MASTER_USDT_ETH",
        usdt_contract: pickUsdtTokenAddress(Chain.ETH),
      };
    }
    case "evm_usdt_bnb": {
      const m = re.sweepMasterUsdtBnb?.trim() ?? "";
      return {
        configured: Boolean(m),
        destination_address: m || null,
        master_env: "SWEEP_MASTER_USDT_BNB",
        usdt_contract: pickUsdtTokenAddress(Chain.BNB),
      };
    }
    case "solana_usdt": {
      const m = re.sweepMasterSolana?.trim() ?? "";
      return {
        configured: Boolean(m),
        destination_address: m || null,
        master_env: "SWEEP_MASTER_SOLANA",
        solana_rpc_url: re.solanaRpcUrl.replace(/\/$/, ""),
        solana_usdt_mint: re.solanaUsdtMint.trim(),
      };
    }
    default:
      return {
        configured: false,
        destination_address: null,
        master_env: "",
      };
  }
}

const sweepWalletInclude = {
  merchant: { select: { email: true, displayName: true } },
  assignedUser: { select: { externalUserId: true } },
};

/**
 * Only query `chain: SOLANA` after pg_enum confirms the value exists — otherwise
 * Postgres returns 22P02 and Prisma logs an error even inside try/catch.
 *
 * @returns {Promise<import("@prisma/client").Wallet[]>}
 */
async function findSolanaSweepWalletsSafe() {
  if (!(await postgresChainEnumHasSolana())) {
    return [];
  }
  return prisma.wallet.findMany({
    where: {
      chain: Chain.SOLANA,
      currency: "USDT",
      network: "SPL",
    },
    orderBy: { createdAt: "asc" },
    include: sweepWalletInclude,
  });
}

/**
 * @returns {Promise<{ wallets: object[], total: number }>}
 */
export async function listUnifiedSweepTargets() {
  const [coreRows, solanaRows] = await Promise.all([
    prisma.wallet.findMany({
      where: {
        OR: [
          { chain: Chain.TRON, currency: "USDT", network: "TRC20" },
          { chain: Chain.TRON, currency: "TRX", network: "TRON" },
          { chain: Chain.ETH, currency: "USDT", network: "ERC20" },
          { chain: Chain.BNB, currency: "USDT", network: "BEP20" },
        ],
      },
      orderBy: { createdAt: "asc" },
      include: sweepWalletInclude,
    }),
    findSolanaSweepWalletsSafe(),
  ]);

  const rows = [...coreRows, ...solanaRows].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );

  const wallets = rows.map((w) => {
    const kind = sweepKindForWallet(w);
    const cfg = kind ? sweepConfiguration(kind) : null;
    return {
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
      ...(cfg?.uses_tron_usdt_master_fallback
        ? { uses_tron_usdt_master_fallback: true }
        : {}),
      ...(cfg?.usdt_contract ? { usdt_contract: cfg.usdt_contract } : {}),
      ...(cfg?.solana_rpc_url
        ? {
            solana_rpc_url: cfg.solana_rpc_url,
            solana_usdt_mint: cfg.solana_usdt_mint,
          }
        : {}),
    };
  });

  return { wallets, total: wallets.length };
}

/**
 * @param {SweepKind} kind
 */
function sweepKindLabel(kind) {
  switch (kind) {
    case "tron_usdt":
      return "USDT · TRC20";
    case "tron_trx":
      return "TRX · TRON";
    case "evm_usdt_eth":
      return "USDT · ERC20";
    case "evm_usdt_bnb":
      return "USDT · BEP20";
    case "solana_usdt":
      return "USDT · SPL";
    default:
      return kind;
  }
}

/**
 * @param {string} walletId
 */
export async function sweepUnifiedOne(walletId) {
  const wid =
    typeof walletId === "number" && Number.isInteger(walletId)
      ? walletId
      : /^\d+$/.test(String(walletId ?? "").trim())
        ? parseInt(String(walletId).trim(), 10)
        : null;
  const wallet = await prisma.wallet.findFirst({
    where: wid != null ? { id: wid } : { publicId: String(walletId ?? "").trim() },
    select: { id: true, chain: true, currency: true, network: true },
  });

  if (!wallet) {
    return { ok: false, error: "WALLET_NOT_FOUND" };
  }

  const kind = sweepKindForWallet(wallet);
  if (!kind) {
    return { ok: false, error: "NOT_SWEEPABLE" };
  }

  const cfg = sweepConfiguration(kind);
  if (!cfg.configured) {
    return {
      ok: false,
      error: "SWEEP_NOT_CONFIGURED",
      sweep_kind: kind,
      master_env: cfg.master_env,
    };
  }

  let inner;
  switch (kind) {
    case "tron_usdt":
      inner = await sweepTronUsdtOne(walletId);
      break;
    case "tron_trx":
      inner = await sweepTronTrxOne(walletId);
      break;
    case "evm_usdt_eth":
      inner = await sweepEvmUsdtOne(walletId, Chain.ETH);
      break;
    case "evm_usdt_bnb":
      inner = await sweepEvmUsdtOne(walletId, Chain.BNB);
      break;
    case "solana_usdt":
      inner = await sweepSolanaUsdtOne(walletId);
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
      const cfg = sweepConfiguration(kind);
      unconfigured.push({
        sweep_kind: kind,
        sweep_label: sweepKindLabel(kind),
        master_env: cfg.master_env,
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
  await ingest("tron_trx", sweepTronTrxAll());
  await ingest("evm_usdt_eth", sweepEvmUsdtAll(Chain.ETH));
  await ingest("evm_usdt_bnb", sweepEvmUsdtAll(Chain.BNB));
  await ingest("solana_usdt", sweepSolanaUsdtAll());

  return { results, summary, unconfigured };
}
