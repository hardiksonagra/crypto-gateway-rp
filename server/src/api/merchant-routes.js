import { Router } from "express";
import {
  Chain,
  MerchantGatewayEnv,
  TxStatus,
  WithdrawalStatus,
} from "@prisma/client";
import { formatAtomicAmountString } from "../lib/format-atomic-amount.js";
import {
  reactivateWalletDepositScan,
  walletScanTtlMinutes,
} from "../lib/wallet-scan.js";
import { prisma } from "../lib/prisma.js";
import {
  aggregateWalletTxStats,
  loadWalletDepositActivity,
} from "../lib/wallet-deposit-stats.js";
import {
  batchUserAssignmentStats,
  batchUserPayerTxStats,
  loadUserAssignmentHistory,
  loadUserPayerDepositHistory,
} from "../lib/user-portal-stats.js";
import { requireAuth } from "../middleware/require-auth.js";
import { PORTAL_ROLE_MERCHANT } from "../constants/portal-role.js";
import { logPanelMutations } from "../middleware/log-panel-mutations.js";
import { parsePageQuery } from "../lib/pagination.js";
import { ensureMerchantPortalEnvironmentConsistent } from "../lib/merchant-gateway-env.js";
import {
  computeMerchantBalances,
  merchantBalanceForAsset,
} from "../services/merchant-balance.js";
import { buildAllPendingPreviews } from "../services/settlement-batch.js";
import {
  proofPathForFileName,
} from "../lib/settlement-upload.js";
import fs from "fs";
import { re } from "../config/runtime-env.js";
import { isEvmChain } from "../config/chains.js";
import { nativeSymbolForChain } from "../services/native-symbols.js";
import { sendEvmNativeFromMerchantPool } from "../services/withdraw/evm-native-withdraw.js";
import { logger } from "../lib/logger.js";
import { redeliverPaymentSuccessWebhook } from "../services/callback-service.js";
import { parseDefaultChainsArray } from "../lib/default-chains.js";
import {
  merchantSettlementWhereFromRouteParam,
  userWhereFromRouteParam,
  walletWhereFromRouteParam,
} from "../lib/entity-internal-id.js";
import {
  parseSupportedDepositRailsInput,
  pickMerchantDefaultPair,
} from "../lib/merchant-default-pair.js";
import { ethers } from "ethers";

const CHAIN_SET = new Set(Object.values(Chain));

const router = Router();
const merchantOnly = requireAuth(PORTAL_ROLE_MERCHANT);

router.use("/api/v1/merchant", merchantOnly, logPanelMutations("merchant"));

/**
 * JWT `sub` as merchant integer PK.
 * @param {{ auth?: { sub?: string } }} req
 * @returns {number | null}
 */
function merchantId(req) {
  const sub = req.auth?.sub;
  if (sub == null || sub === "") return null;
  const n = parseInt(String(sub).trim(), 10);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/**
 * Portal lists use `portal_environment` on the merchant row (not query params).
 *
 * @param {number} mid
 */
async function resolveMerchantPortalForLists(mid) {
  const synced = await ensureMerchantPortalEnvironmentConsistent(mid);
  if (!synced) {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  const environment = synced.portalEnvironment;
  if (
    environment === MerchantGatewayEnv.sandbox &&
    !synced.sandboxGatewayEnabled
  ) {
    return {
      ok: false,
      status: 403,
      error: "sandbox_gateway_disabled",
      message: "Sandbox is disabled for your account. Ask an admin to enable it.",
    };
  }
  if (environment === MerchantGatewayEnv.live && !synced.liveGatewayEnabled) {
    return {
      ok: false,
      status: 403,
      error: "live_gateway_disabled",
      message: "Live gateway is disabled for your account.",
    };
  }
  if (!synced.liveGatewayEnabled && !synced.sandboxGatewayEnabled) {
    return {
      ok: false,
      status: 403,
      error: "gateway_disabled",
      message:
        "Neither live nor sandbox gateway is enabled for your account. Contact support.",
    };
  }
  return {
    ok: true,
    environment,
    flags: {
      liveGatewayEnabled: synced.liveGatewayEnabled,
      sandboxGatewayEnabled: synced.sandboxGatewayEnabled,
    },
  };
}

router.get("/api/v1/merchant/dashboard", async (req, res) => {
  const mid = merchantId(req);
  if (!mid) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const gate = await resolveMerchantPortalForLists(mid);
  if (!gate.ok) {
    res.status(gate.status).json({
      error: gate.error,
      ...(gate.message ? { message: gate.message } : {}),
    });
    return;
  }
  const { environment } = gate;

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [merchRates, recent, users, txs] = await Promise.all([
    prisma.merchant.findUnique({
      where: { id: mid },
      select: {
        mdrPercent: true,
        settlementRatePercent: true,
        minSettlementAmount: true,
        settlementPeriodDays: true,
      },
    }),
    prisma.transaction.findMany({
      where: {
        wallet: { merchantId: mid, environment },
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: {
        wallet: { select: { address: true } },
      },
    }),
    prisma.user.count({
      where: { merchantId: mid, environment },
    }),
    prisma.transaction.count({
      where: { wallet: { merchantId: mid, environment } },
    }),
  ]);
  if (!merchRates) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const mdrP = Number(merchRates.mdrPercent);
  const settlementP = Number(merchRates.settlementRatePercent);
  const periodDays = Number(merchRates.settlementPeriodDays ?? 0);
  const balances = await computeMerchantBalances(mid, environment);
  const pendingSettlementBatches = await buildAllPendingPreviews(
    mid,
    environment,
    merchRates,
  );
  res.json({
    environment,
    portal: {
      live_gateway_enabled: gate.flags.liveGatewayEnabled,
      sandbox_gateway_enabled: gate.flags.sandboxGatewayEnabled,
    },
    fee_rates: {
      mdr_percent: mdrP,
      settlement_rate_percent: settlementP,
      min_settlement_amount: merchRates.minSettlementAmount ?? "0",
      settlement_period_days: periodDays,
    },
    balances,
    pending_settlement_batches: pendingSettlementBatches,
    stats: { end_users: users, transactions: txs },
    recent_transactions: recent.map((t) => ({
      id: t.id,
      tx_hash: t.txHash,
      chain: t.chain,
      status: t.status,
      token_symbol: t.tokenSymbol,
      token_decimals: t.tokenDecimals,
      amount: t.amount,
      amount_decimal: formatAtomicAmountString(t.amount, t.tokenDecimals),
      created_at: t.createdAt,
      wallet_address: t.wallet.address,
    })),
  });
});

router.get("/api/v1/merchant/users", async (req, res) => {
  const mid = merchantId(req);
  if (!mid) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const gate = await resolveMerchantPortalForLists(mid);
  if (!gate.ok) {
    res.status(gate.status).json({
      error: gate.error,
      ...(gate.message ? { message: gate.message } : {}),
    });
    return;
  }
  const { environment } = gate;
  const { skip, take, page, pageSize } = parsePageQuery(req.query);
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const where = {
    merchantId: mid,
    environment,
    ...(q
      ? {
          OR: [
            { externalUserId: { contains: q, mode: "insensitive" } },
            ...(/^\d+$/.test(q) ? [{ id: parseInt(q, 10) }] : []),
          ],
        }
      : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: { _count: { select: { assignedWallets: true } } },
    }),
  ]);
  const uids = rows.map((u) => u.id);
  const [assignStats, payerStats] = await Promise.all([
    batchUserAssignmentStats(uids),
    batchUserPayerTxStats(uids),
  ]);
  res.json({
    page,
    pageSize,
    total,
    environment,
    users: rows.map((u) => {
      const asg = assignStats.get(u.id);
      const pay = payerStats.get(u.id);
      return {
        id: u.id,
        external_user_id: u.externalUserId,
        environment: u.environment,
        wallets_now_assigned: u._count.assignedWallets,
        wallet_assignment_event_count: asg?.event_count ?? 0,
        distinct_wallets_in_assignment_log: asg?.distinct_wallets ?? 0,
        payer_transaction_count: pay?.total_tx ?? 0,
        payer_success_transaction_count: pay?.success_tx ?? 0,
        created_at: u.createdAt,
      };
    }),
  });
});

router.get(
  "/api/v1/merchant/users/:userId/wallet-assignment-history",
  async (req, res) => {
    const mid = merchantId(req);
    if (!mid) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const gate = await resolveMerchantPortalForLists(mid);
    if (!gate.ok) {
      res.status(gate.status).json({
        error: gate.error,
        ...(gate.message ? { message: gate.message } : {}),
      });
      return;
    }
    const { environment } = gate;
    const userId =
      typeof req.params.userId === "string" ? req.params.userId.trim() : "";
    if (!userId) {
      res.status(400).json({ error: "user_id_required" });
      return;
    }
    const uw = userWhereFromRouteParam(userId);
    if (!uw) {
      res.status(400).json({ error: "user_id_required" });
      return;
    }
    const owns = await prisma.user.findFirst({
      where: { AND: [uw, { merchantId: mid, environment }] },
      select: { id: true },
    });
    if (!owns) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const limRaw = req.query.limit;
    const limit =
      typeof limRaw === "string" && limRaw.trim()
        ? parseInt(limRaw, 10)
        : 200;
    const events = await loadUserAssignmentHistory(
      owns.id,
      Number.isFinite(limit) ? limit : 200,
    );
    res.json({
      user_id: owns.id,
      events,
      source_labels: {
        existing_session: "Same rail wallet refreshed (deposit-address / create-wallet)",
        pool_pick: "Picked from merchant pool",
        new_wallet: "New address generated",
      },
    });
  },
);

router.get(
  "/api/v1/merchant/users/:userId/payer-deposit-history",
  async (req, res) => {
    const mid = merchantId(req);
    if (!mid) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const gate = await resolveMerchantPortalForLists(mid);
    if (!gate.ok) {
      res.status(gate.status).json({
        error: gate.error,
        ...(gate.message ? { message: gate.message } : {}),
      });
      return;
    }
    const { environment } = gate;
    const userId =
      typeof req.params.userId === "string" ? req.params.userId.trim() : "";
    if (!userId) {
      res.status(400).json({ error: "user_id_required" });
      return;
    }
    const uw = userWhereFromRouteParam(userId);
    if (!uw) {
      res.status(400).json({ error: "user_id_required" });
      return;
    }
    const owns = await prisma.user.findFirst({
      where: { AND: [uw, { merchantId: mid, environment }] },
      select: { id: true },
    });
    if (!owns) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const limRaw = req.query.limit;
    const limit =
      typeof limRaw === "string" && limRaw.trim()
        ? parseInt(limRaw, 10)
        : 200;
    const data = await loadUserPayerDepositHistory(
      owns.id,
      Number.isFinite(limit) ? limit : 200,
    );
    res.json({ user_id: owns.id, ...data });
  },
);

router.get("/api/v1/merchant/wallets", async (req, res) => {
  const mid = merchantId(req);
  if (!mid) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const gate = await resolveMerchantPortalForLists(mid);
  if (!gate.ok) {
    res.status(gate.status).json({
      error: gate.error,
      ...(gate.message ? { message: gate.message } : {}),
    });
    return;
  }
  const { environment } = gate;
  const { skip, take, page, pageSize } = parsePageQuery(req.query);
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const where = {
    merchantId: mid,
    environment,
    ...(q
      ? {
          OR: [
            ...(/^\d+$/.test(q) ? [{ id: parseInt(q, 10) }] : []),
            { address: { contains: q, mode: "insensitive" } },
            {
              assignedUser: {
                externalUserId: { contains: q, mode: "insensitive" },
              },
            },
          ],
        }
      : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.wallet.count({ where }),
    prisma.wallet.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        assignedUser: { select: { externalUserId: true } },
        _count: { select: { transactions: true } },
      },
    }),
  ]);
  const statsByWallet = await aggregateWalletTxStats(rows.map((w) => w.id));
  const now = new Date();
  const ttlMin = walletScanTtlMinutes();
  res.json({
    page,
    pageSize,
    total,
    environment,
    deposit_scan_ttl_minutes: ttlMin,
    wallets: rows.map((w) => {
      const txCount = w._count.transactions;
      const exp = w.scanExpiresAt;
      const deposit_scan_active =
        txCount > 0 || exp == null || exp > now;
      const st = statsByWallet.get(w.id);
      return {
        id: w.id,
        address: w.address,
        chain: w.chain,
        currency: w.currency,
        network: w.network,
        external_user_id: w.assignedUser?.externalUserId ?? null,
        created_at: w.createdAt,
        scan_expires_at: exp?.toISOString() ?? null,
        transaction_count: txCount,
        distinct_payer_users: st?.distinct_payers ?? 0,
        success_deposit_count: st?.success_tx ?? 0,
        deposit_scan_active,
      };
    }),
  });
});

router.get(
  "/api/v1/merchant/wallets/:walletId/deposit-activity",
  async (req, res) => {
    const mid = merchantId(req);
    if (!mid) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const gate = await resolveMerchantPortalForLists(mid);
    if (!gate.ok) {
      res.status(gate.status).json({
        error: gate.error,
        ...(gate.message ? { message: gate.message } : {}),
      });
      return;
    }
    const { environment } = gate;
    const walletId =
      typeof req.params.walletId === "string" ? req.params.walletId.trim() : "";
    if (!walletId) {
      res.status(400).json({ error: "wallet_id_required" });
      return;
    }
    const ww = walletWhereFromRouteParam(walletId);
    if (!ww) {
      res.status(400).json({ error: "wallet_id_required" });
      return;
    }
    const owns = await prisma.wallet.findFirst({
      where: { AND: [ww, { merchantId: mid, environment }] },
      select: { id: true },
    });
    if (!owns) {
      res.status(404).json({ error: "wallet_not_found" });
      return;
    }
    const limRaw = req.query.limit;
    const limit =
      typeof limRaw === "string" && limRaw.trim()
        ? parseInt(limRaw, 10)
        : 100;
    const data = await loadWalletDepositActivity(
      owns.id,
      Number.isFinite(limit) ? limit : 100,
    );
    res.json({
      wallet_id: owns.id,
      note: "Rows are on-chain deposits we recorded. API address assignments without a deposit are not listed.",
      ...data,
    });
  },
);

router.post(
  "/api/v1/merchant/wallets/:walletId/reactivate-deposit-scan",
  async (req, res) => {
    const mid = merchantId(req);
    if (!mid) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const walletId =
      typeof req.params.walletId === "string"
        ? req.params.walletId.trim()
        : "";
    if (!walletId) {
      res.status(400).json({ error: "wallet_id_required" });
      return;
    }
    const gate = await resolveMerchantPortalForLists(mid);
    if (!gate.ok) {
      res.status(gate.status).json({
        error: gate.error,
        ...(gate.message ? { message: gate.message } : {}),
      });
      return;
    }
    if (gate.environment !== MerchantGatewayEnv.live) {
      res.status(400).json({
        error: "live_only",
        message: "Reactivate deposit scan is only for live wallets.",
      });
      return;
    }
    const ww = walletWhereFromRouteParam(walletId);
    if (!ww) {
      res.status(400).json({ error: "wallet_id_required" });
      return;
    }
    const owns = await prisma.wallet.findFirst({
      where: {
        AND: [ww, { merchantId: mid, environment: MerchantGatewayEnv.live }],
      },
      select: { id: true },
    });
    if (!owns) {
      res.status(404).json({ error: "wallet_not_found" });
      return;
    }
    try {
      const row = await reactivateWalletDepositScan(walletId, {
        merchantId: mid,
      });
      res.json({
        ok: true,
        wallet_id: row.id,
        scan_expires_at: row.scanExpiresAt?.toISOString() ?? null,
        deposit_scan_queued_next_worker_tick: true,
        deposit_scan_ttl_minutes: walletScanTtlMinutes(),
      });
    } catch (e) {
      const code = /** @type {any} */ (e).code;
      if (code === "WALLET_NOT_FOUND") {
        res.status(404).json({ error: "wallet_not_found" });
        return;
      }
      if (code === "FORBIDDEN") {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      throw e;
    }
  },
);

router.get("/api/v1/merchant/transactions", async (req, res) => {
  const mid = merchantId(req);
  if (!mid) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const gate = await resolveMerchantPortalForLists(mid);
  if (!gate.ok) {
    res.status(gate.status).json({
      error: gate.error,
      ...(gate.message ? { message: gate.message } : {}),
    });
    return;
  }
  const { environment } = gate;
  const { skip, take, page, pageSize } = parsePageQuery(req.query);
  const chain =
    typeof req.query.chain === "string" ? req.query.chain.trim() : "";
  const status =
    typeof req.query.status === "string" ? req.query.status.trim() : "";
  const token =
    typeof req.query.token_symbol === "string"
      ? req.query.token_symbol.trim()
      : "";
  const qUser =
    typeof req.query.external_user_id === "string"
      ? req.query.external_user_id.trim()
      : "";

  const where = {
    wallet: {
      is: {
        merchantId: mid,
        environment,
      },
    },
    ...(qUser
      ? {
          OR: [
            {
              payerUser: {
                is: {
                  merchantId: mid,
                  externalUserId: { contains: qUser, mode: "insensitive" },
                },
              },
            },
            {
              wallet: {
                is: {
                  merchantId: mid,
                  environment,
                  assignedUser: {
                    is: {
                      externalUserId: { contains: qUser, mode: "insensitive" },
                    },
                  },
                },
              },
            },
          ],
        }
      : {}),
    ...(chain && CHAIN_SET.has(chain) ? { chain } : {}),
    ...(status && Object.values(TxStatus).includes(status) ? { status } : {}),
    ...(token ? { tokenSymbol: { equals: token, mode: "insensitive" } } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.transaction.count({ where }),
    prisma.transaction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        payerUser: { select: { externalUserId: true } },
        wallet: {
          include: {
            assignedUser: { select: { externalUserId: true } },
          },
        },
      },
    }),
  ]);

  res.json({
    page,
    pageSize,
    total,
    environment,
    transactions: rows.map((t) => ({
      id: t.id,
      tx_hash: t.txHash,
      chain: t.chain,
      status: t.status,
      token_symbol: t.tokenSymbol,
      token_decimals: t.tokenDecimals,
      amount: t.amount,
      amount_decimal: formatAtomicAmountString(t.amount, t.tokenDecimals),
      confirmations: t.confirmations,
      from_address: t.fromAddress,
      to_address: t.toAddress,
      wallet_id: t.walletId,
      wallet_address: t.wallet.address,
      currency: t.wallet.currency,
      network: t.wallet.network,
      block_number: t.blockNumber?.toString() ?? null,
      log_index: t.logIndex,
      callback_delivered_at: t.callbackDeliveredAt,
      external_user_id:
        t.payerUser?.externalUserId ?? t.wallet.assignedUser?.externalUserId ?? null,
      gateway_environment: t.wallet.environment,
      created_at: t.createdAt,
      updated_at: t.updatedAt,
    })),
  });
});

router.post(
  "/api/v1/merchant/transactions/:transactionId/redeliver-callback",
  async (req, res) => {
    const mid = merchantId(req);
    if (!mid) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const transactionId =
      typeof req.params.transactionId === "string"
        ? req.params.transactionId.trim()
        : "";
    if (!transactionId) {
      res.status(400).json({ error: "transaction_id_required" });
      return;
    }

    const actorRow = await prisma.merchant.findUnique({
      where: { id: mid },
      select: { email: true },
    });
    const result = await redeliverPaymentSuccessWebhook(transactionId, mid, {
      actorEmail: actorRow?.email ?? null,
    });
    if (result.ok) {
      res.status(200).json({ ok: true });
      return;
    }
    if (result.code === "transaction_not_found") {
      res.status(404).json({ error: result.code });
      return;
    }
    if (
      result.code === "callback_requires_success" ||
      result.code === "callback_url_not_set"
    ) {
      res.status(400).json({
        error: result.code,
        ...(result.message ? { message: result.message } : {}),
      });
      return;
    }
    res.status(502).json({
      error: result.code,
      ...(result.message ? { message: result.message } : {}),
      ...(result.httpStatus != null ? { upstream_status: result.httpStatus } : {}),
      ...(result.bodySnippet ? { upstream_body_snippet: result.bodySnippet } : {}),
    });
  },
);

router.get("/api/v1/merchant/withdrawals", async (req, res) => {
  const mid = merchantId(req);
  if (!mid) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const { skip, take, page, pageSize } = parsePageQuery(req.query);
  const chain =
    typeof req.query.chain === "string" ? req.query.chain.trim() : "";
  const status =
    typeof req.query.status === "string" ? req.query.status.trim() : "";
  const token =
    typeof req.query.token_symbol === "string"
      ? req.query.token_symbol.trim()
      : "";
  const toAddr =
    typeof req.query.to_address === "string" ? req.query.to_address.trim() : "";

  const where = {
    merchantId: mid,
    ...(chain && CHAIN_SET.has(chain) ? { chain } : {}),
    ...(status && Object.values(WithdrawalStatus).includes(status)
      ? { status }
      : {}),
    ...(token ? { tokenSymbol: { equals: token, mode: "insensitive" } } : {}),
    ...(toAddr
      ? {
          toAddress: toAddr.startsWith("0x")
            ? { equals: toAddr, mode: "insensitive" }
            : { contains: toAddr, mode: "insensitive" },
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.withdrawal.count({ where }),
    prisma.withdrawal.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
  ]);
  res.json({ page, pageSize, total, withdrawals: rows });
});

router.post("/api/v1/merchant/withdrawals", async (req, res) => {
  const mid = merchantId(req);
  if (!mid) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const merchantGate = await prisma.merchant.findUnique({
    where: { id: mid },
    select: { id: true, liveGatewayEnabled: true },
  });
  if (!merchantGate?.liveGatewayEnabled) {
    res.status(403).json({
      error: "live_gateway_disabled",
      message:
        "Withdrawals use live on-chain balances. Enable live gateway for your merchant (admin).",
    });
    return;
  }
  const merchInt = merchantGate.id;
  const body = req.body ?? {};
  const chainStr = body.chain?.trim();
  const to = body.to_address?.trim();
  const amountStr = body.amount?.trim();
  const tokenSymbol = body.token_symbol?.trim();
  if (!chainStr || !to || !amountStr || !tokenSymbol) {
    res
      .status(400)
      .json({ error: "chain, to_address, amount, token_symbol required" });
    return;
  }
  const CHAINS = new Set(Object.values(Chain));
  if (!CHAINS.has(chainStr)) {
    res.status(400).json({ error: "invalid chain" });
    return;
  }
  const chain = chainStr;
  const expectedNative = nativeSymbolForChain(chain);
  if (tokenSymbol.toUpperCase() !== expectedNative.toUpperCase()) {
    res.status(400).json({
      error: "only_native_withdraw_supported",
      expected_token_symbol: expectedNative,
    });
    return;
  }
  let amount;
  try {
    amount = BigInt(amountStr);
  } catch {
    res.status(400).json({ error: "invalid amount" });
    return;
  }
  if (amount <= 0n) {
    res.status(400).json({ error: "amount must be positive" });
    return;
  }

  const available = await merchantBalanceForAsset(mid, chain, expectedNative);
  if (available < amount) {
    res
      .status(400)
      .json({
        error: "insufficient_balance",
        available_raw: available.toString(),
      });
    return;
  }

  if (!isEvmChain(chain)) {
    res.status(501).json({
      error: "chain_withdraw_not_implemented",
      detail: "EVM native withdrawals only in this release.",
    });
    return;
  }

  if (!ethers.isAddress(to)) {
    res.status(400).json({ error: "invalid_evm_address" });
    return;
  }
  const checksumTo = ethers.getAddress(to);

  let wId;
  try {
    const row = await prisma.withdrawal.create({
      data: {
        merchantId: merchInt,
        chain,
        tokenSymbol: expectedNative,
        toAddress: checksumTo,
        amount: amountStr,
        status: WithdrawalStatus.processing,
      },
    });
    wId = row.id;
    const { txHash, fromAddress } = await sendEvmNativeFromMerchantPool({
      merchantId: merchInt,
      chain,
      toAddress: checksumTo,
      amountWei: amount,
    });
    await prisma.withdrawal.update({
      where: { id: wId },
      data: { status: WithdrawalStatus.completed, txHash },
    });
    res.status(201).json({
      id: wId,
      status: WithdrawalStatus.completed,
      tx_hash: txHash,
      from_address: fromAddress,
    });
  } catch (e) {
    const msg = String(e);
    logger.error("merchant withdraw failed", { mid, err: msg });
    if (wId) {
      await prisma.withdrawal.updateMany({
        where: { id: wId, merchantId: merchInt },
        data: {
          status: WithdrawalStatus.failed,
          failureReason: msg.slice(0, 2000),
        },
      });
    }
    if (msg.includes("NO_FUNDED_WALLET")) {
      res.status(409).json({
        error: "no_onchain_liquidity",
        detail:
          "Virtual balance exists but no single deposit wallet on this chain has enough native coin plus gas. Sweep or consolidate first.",
      });
      return;
    }
    res
      .status(500)
      .json({ error: "withdraw_failed", detail: msg.slice(0, 500) });
  }
});

router.patch("/api/v1/merchant/settings", async (req, res) => {
  const mid = merchantId(req);
  if (!mid) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const body = req.body ?? {};
  const existing = await prisma.merchant.findUnique({
    where: { id: mid },
    select: {
      defaultChains: true,
      defaultCurrency: true,
      defaultNetwork: true,
      supportedDepositRails: true,
    },
  });
  if (!existing) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const data = {};
  if (body.callback_url !== undefined) data.callbackUrl = body.callback_url;

  let nextChains = existing.defaultChains ?? [];
  if (body.default_chains !== undefined) {
    const parsedChains = parseDefaultChainsArray(body.default_chains, {
      minOne: true,
    });
    if ("error" in parsedChains) {
      res.status(400).json({ error: parsedChains.error });
      return;
    }
    data.defaultChains = parsedChains.chains;
    nextChains = parsedChains.chains;
  }

  let nextSupported = existing.supportedDepositRails ?? [];
  if (body.supported_deposit_rails !== undefined) {
    const pr = parseSupportedDepositRailsInput(
      body.supported_deposit_rails,
      nextChains,
    );
    if ("error" in pr) {
      res.status(400).json({ error: pr.error });
      return;
    }
    data.supportedDepositRails = pr.keys;
    nextSupported = pr.keys;
  } else if (nextSupported.length > 0 && !re.gatewayTronUsdtOnly) {
    const v = parseSupportedDepositRailsInput(nextSupported, nextChains);
    if ("error" in v) {
      res.status(400).json({ error: v.error });
      return;
    }
    nextSupported = v.keys;
  }

  const constraintKeys = nextSupported.length > 0 ? nextSupported : null;
  const needPairUpdate =
    body.default_chains !== undefined ||
    body.default_currency !== undefined ||
    body.default_network !== undefined ||
    body.supported_deposit_rails !== undefined;

  if (needPairUpdate) {
    const deriveDefaultFromSupported =
      body.supported_deposit_rails !== undefined &&
      body.default_currency === undefined &&
      body.default_network === undefined;
    const pairBody = deriveDefaultFromSupported
      ? { default_currency: undefined, default_network: undefined }
      : {
          default_currency:
            body.default_currency !== undefined
              ? body.default_currency
              : existing.defaultCurrency,
          default_network:
            body.default_network !== undefined
              ? body.default_network
              : existing.defaultNetwork,
        };
    const picked = pickMerchantDefaultPair(pairBody, nextChains, constraintKeys);
    if ("error" in picked && picked.error) {
      res.status(400).json({ error: picked.error });
      return;
    }
    data.defaultCurrency = picked.currency;
    data.defaultNetwork = picked.network;
  }

  if (Object.keys(data).length === 0) {
    res.status(400).json({ error: "no_updates" });
    return;
  }
  await prisma.merchant.update({ where: { id: mid }, data });
  res.json({ ok: true });
});

router.get("/api/v1/merchant/settlements/pending-preview", async (req, res) => {
  const mid = merchantId(req);
  if (!mid) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const gate = await resolveMerchantPortalForLists(mid);
  if (!gate.ok) {
    res.status(gate.status).json({
      error: gate.error,
      ...(gate.message ? { message: gate.message } : {}),
    });
    return;
  }
  const { environment } = gate;
  const merchRates = await prisma.merchant.findUnique({
    where: { id: mid },
    select: {
      id: true,
      mdrPercent: true,
      settlementRatePercent: true,
      minSettlementAmount: true,
      settlementPeriodDays: true,
    },
  });
  if (!merchRates) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const buckets = await buildAllPendingPreviews(
    merchRates.id,
    environment,
    merchRates,
  );
  res.json({
    environment,
    fee_rates: {
      mdr_percent: Number(merchRates.mdrPercent),
      settlement_rate_percent: Number(merchRates.settlementRatePercent),
      min_settlement_amount: merchRates.minSettlementAmount,
      settlement_period_days: Number(merchRates.settlementPeriodDays ?? 0),
    },
    buckets,
  });
});

router.get("/api/v1/merchant/settlements", async (req, res) => {
  const mid = merchantId(req);
  if (!mid) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const gate = await resolveMerchantPortalForLists(mid);
  if (!gate.ok) {
    res.status(gate.status).json({
      error: gate.error,
      ...(gate.message ? { message: gate.message } : {}),
    });
    return;
  }
  const { environment } = gate;
  const { skip, take, page, pageSize } = parsePageQuery(req.query);
  const where = { merchantId: mid, environment };
  const [total, rows] = await Promise.all([
    prisma.merchantSettlement.count({ where }),
    prisma.merchantSettlement.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: {
        id: true,
        environment: true,
        chain: true,
        tokenSymbol: true,
        tokenDecimals: true,
        netAmount: true,
        transactionCount: true,
        proofFileName: true,
        createdAt: true,
      },
    }),
  ]);
  res.json({
    total,
    page,
    pageSize,
    settlements: rows.map((s) => ({
      id: s.id,
      environment: s.environment,
      chain: s.chain,
      token_symbol: s.tokenSymbol,
      token_decimals: s.tokenDecimals,
      net_amount: s.netAmount,
      transaction_count: s.transactionCount,
      has_proof: Boolean(s.proofFileName),
      created_at: s.createdAt,
    })),
  });
});

router.get("/api/v1/merchant/settlements/:id/proof", async (req, res) => {
  const mid = merchantId(req);
  if (!mid) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const id = String(req.params.id ?? "");
  const sw = merchantSettlementWhereFromRouteParam(id);
  if (!sw) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const row = await prisma.merchantSettlement.findFirst({
    where: { AND: [sw, { merchantId: mid }] },
    select: { proofFileName: true },
  });
  if (!row?.proofFileName) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const full = proofPathForFileName(row.proofFileName);
  if (!full || !fs.existsSync(full)) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.sendFile(full);
});

export { router as merchantRouter };
