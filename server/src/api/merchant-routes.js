import { Router } from "express";
import { Chain, MerchantGatewayEnv, Prisma, TxStatus } from "@prisma/client";
import { formatAtomicAmountString } from "../lib/format-atomic-amount.js";
import {
  expectedReceivedAmountQuadForTransaction,
  loadExpectedAtomicByWalletSessionForTransactions,
  requestedAmountFieldsForTransaction,
} from "../lib/transaction-requested-amounts.js";
import {
  reactivateWalletDepositScan,
  walletScanTtlMinutes,
} from "../lib/wallet-scan.js";
import { ACTIVE } from "../lib/active-row.js";
import {
  countMerchantPortalTransactionsRaw,
  listMerchantDashboardRecentTxRaw,
  listMerchantPortalTransactionsRaw,
} from "../lib/merchant-transactions-list-raw.js";
import {
  countMerchantLedgerUnion,
  fetchMerchantLedgerUnionPage,
  parseLedgerKindQuery,
} from "../lib/merchant-ledger-merge.js";
import { prisma } from "../lib/prisma.js";
import { prismaClientKnowsTxStatusCreated } from "../lib/prisma-tx-status.js";
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
import { resolveMerchantPortalForLists } from "../lib/merchant-portal-for-lists.js";
import { computeMerchantBalances } from "../services/merchant-balance.js";
import { withdrawalPublicJson } from "../lib/merchant-withdrawal-response.js";
import { fillMissingWithdrawalNetworkFees } from "../services/payout-withdrawal-network-fee.js";
import {
  getMerchantBulkWalletBalanceRefreshStatus,
  startMerchantBulkWalletBalanceRefresh,
} from "../services/wallet/wallet-balance-probe.js";
import {
  isValidFeePercent,
  parseFeePercent,
} from "../lib/merchant-fee-math.js";
import { buildAllPendingPreviews } from "../services/settlement-batch.js";
import { buildPendingPayoutPreviewBuckets } from "../services/merchant-payout-preview.js";
import { proofPathForFileName } from "../lib/settlement-upload.js";
import fs from "fs";
import { re } from "../config/runtime-env.js";
import { logger } from "../lib/logger.js";
import { lastNDatesInZone } from "../lib/ianaTimeZone.js";
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
import { generateApiKey, hashApiKey } from "../lib/api-key.js";
import { encryptMerchantApiKey } from "../lib/merchant-api-key-cipher.js";
import { adminDirectionalUsdtSend } from "../services/sweep/admin-directional-usdt-send.js";
import {
  mergeAutoSwapSettingsPayload,
  validateMerchantAutoSwapState,
} from "../lib/merchant-auto-swap-settings.js";

const CHAIN_SET = new Set(Object.values(Chain));

function railsSortedKey(rails) {
  return [...(rails ?? [])].map(String).sort().join("\u0001");
}

const router = Router();
const merchantOnly = requireAuth(PORTAL_ROLE_MERCHANT);

/** This router only registers `/api/v1/merchant/*`; enforce MERCHANT JWT on every request. */
router.use(merchantOnly, logPanelMutations("merchant"));

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
 * Merchant rotates the unified gateway secret (live + sandbox). Old key stops working immediately.
 */
router.post("/api/v1/merchant/gateway-api-key/regenerate", async (req, res) => {
  const mid = merchantId(req);
  if (!mid) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const existing = await prisma.merchant.findUnique({
    where: { id: mid },
    select: { id: true, deletedAt: true, isActive: true },
  });
  if (!existing || existing.deletedAt != null) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (!existing.isActive) {
    res.status(403).json({
      error: "merchant_inactive",
      message: "Account is inactive.",
    });
    return;
  }
  const k = generateApiKey();
  const h = hashApiKey(k);
  const cipher = encryptMerchantApiKey(k);
  const row = await prisma.merchant.update({
    where: { id: mid },
    data: {
      apiKeyHash: h,
      apiKeyHint: k.slice(-6),
      apiKeyCipher: cipher,
      sandboxApiKeyHash: h,
      sandboxApiKeyHint: k.slice(-6),
      sandboxApiKeyCipher: cipher,
    },
    select: {
      apiKeyHint: true,
      sandboxApiKeyHint: true,
    },
  });
  res.json({
    api_key: k,
    sandbox_api_key: k,
    api_key_hint: row.apiKeyHint,
    sandbox_api_key_hint: row.sandboxApiKeyHint,
    message:
      "New gateway API key (live + sandbox). Update your servers now; the previous key no longer works.",
  });
});

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
  const tzRaw = typeof req.query.tz === "string" ? req.query.tz.trim() : "";
  const viewerTz = tzRaw || "UTC";
  const tzSql = `'${viewerTz.replace(/'/g, "''")}'`;
  const dayKeys = lastNDatesInZone(14, viewerTz);
  const wideFrom = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);

  const txWhere = {
    ...ACTIVE,
    wallet: { is: { merchantId: mid, environment, ...ACTIVE } },
  };

  const byStatusPromise = prismaClientKnowsTxStatusCreated()
    ? prisma.transaction.groupBy({
        by: ["status"],
        where: txWhere,
        _count: { _all: true },
      })
    : prisma
        .$queryRaw(
          Prisma.sql`
          SELECT t.status::text AS status, COUNT(*)::int AS cnt
          FROM transactions t
          INNER JOIN wallets w ON w.id = t.wallet_id
          WHERE w.merchant_id = ${mid}
            AND w.environment = ${environment}::"MerchantGatewayEnv"
            AND w.deleted_at IS NULL
            AND t.deleted_at IS NULL
          GROUP BY t.status
        `,
        )
        .then((rows) =>
          rows.map((r) => ({
            status: r.status,
            _count: { _all: Number(r.cnt) },
          })),
        );

  const byChainPromise = prisma.transaction.groupBy({
    by: ["chain"],
    where: txWhere,
    _count: { _all: true },
  });

  const dailyStatusPromise = prisma.$queryRaw(
    Prisma.sql`
      SELECT ((t.created_at AT TIME ZONE ${Prisma.raw(tzSql)}))::date AS day,
             t.status::text AS status,
             COUNT(*)::int AS cnt
      FROM transactions t
      INNER JOIN wallets w ON w.id = t.wallet_id
      WHERE w.merchant_id = ${mid}
        AND w.environment = ${environment}::"MerchantGatewayEnv"
        AND w.deleted_at IS NULL
        AND t.deleted_at IS NULL
        AND t.created_at >= ${wideFrom}
      GROUP BY 1, 2
      ORDER BY 1, 2
    `,
  );

  const recentPromise = prismaClientKnowsTxStatusCreated()
    ? prisma.transaction.findMany({
        where: {
          ...ACTIVE,
          status: TxStatus.success,
          wallet: {
            is: { merchantId: mid, environment, ...ACTIVE },
          },
          createdAt: { gte: since },
        },
        orderBy: { createdAt: "desc" },
        take: 8,
        include: {
          wallet: { select: { address: true } },
        },
      })
    : listMerchantDashboardRecentTxRaw(prisma, { mid, environment, since });

  const [merchRates, recent, users, txs, byStatus, byChain, dailyStatusRows] =
    await Promise.all([
      prisma.merchant.findFirst({
        where: { id: mid, ...ACTIVE },
        select: {
          mdrPercent: true,
          settlementRatePercent: true,
          minSettlementAmount: true,
          settlementPeriodDays: true,
        },
      }),
      recentPromise,
      prisma.user.count({
        where: { merchantId: mid, environment, ...ACTIVE },
      }),
      prisma.transaction.count({
        where: {
          ...ACTIVE,
          wallet: { is: { merchantId: mid, environment, ...ACTIVE } },
        },
      }),
      byStatusPromise,
      byChainPromise,
      dailyStatusPromise,
    ]);
  if (!merchRates) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const recentExpectedByKey =
    await loadExpectedAtomicByWalletSessionForTransactions(recent);
  const mdrP = Number(merchRates.mdrPercent);
  const settlementP = Number(merchRates.settlementRatePercent);
  const periodDays = Number(merchRates.settlementPeriodDays ?? 0);
  const balances = await computeMerchantBalances(mid, environment);
  const pendingSettlementBatches = await buildAllPendingPreviews(
    mid,
    environment,
    merchRates,
  );

  /** @type {Map<string, { pending: number, success: number, failed: number, underpaid: number }>} */
  const dailyMap = new Map();
  for (const row of dailyStatusRows) {
    const dayVal = row.day;
    const key =
      dayVal instanceof Date
        ? dayVal.toISOString().slice(0, 10)
        : String(dayVal).slice(0, 10);
    if (!dailyMap.has(key)) {
      dailyMap.set(key, { pending: 0, success: 0, failed: 0, underpaid: 0 });
    }
    const bucket = /** @type {{ pending: number, success: number, failed: number, underpaid: number }} */ (
      dailyMap.get(key)
    );
    const st = String(row.status);
    const c = Number(row.cnt);
    if (st === "pending" || st === "created") bucket.pending += c;
    else if (st === "success") bucket.success += c;
    else if (st === "failed") bucket.failed += c;
    else if (st === "underpaid") bucket.underpaid += c;
  }

  const transactions_daily_by_status = dayKeys.map((date) => {
    const b = dailyMap.get(date) ?? {
      pending: 0,
      success: 0,
      failed: 0,
      underpaid: 0,
    };
    return {
      date,
      pending: b.pending,
      success: b.success,
      failed: b.failed,
      underpaid: b.underpaid,
    };
  });

  const transactions_by_status = byStatus.map((r) => ({
    status: String(r.status),
    count: r._count._all,
  }));
  const successCount =
    transactions_by_status.find((x) => x.status === "success")?.count ?? 0;
  const totalForRate = transactions_by_status.reduce((s, x) => s + x.count, 0);
  const success_rate_pct =
    totalForRate > 0 ? Math.round((100 * successCount) / totalForRate) : 0;

  const transactions_by_chain = byChain
    .map((r) => ({
      chain: String(r.chain),
      count: r._count._all,
    }))
    .sort((a, b) => b.count - a.count);

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
    charts: {
      viewer_timezone: viewerTz,
      success_rate_pct,
      transactions_daily_by_status,
      transactions_by_status,
      transactions_by_chain,
    },
    recent_transactions: recent.map((t) => ({
      id: t.id,
      transaction_id: t.referenceTransactionId ?? null,
      tx_hash: t.txHash,
      chain: t.chain,
      status: t.status,
      token_symbol: t.tokenSymbol,
      token_decimals: t.tokenDecimals,
      amount: t.amount,
      amount_decimal: formatAtomicAmountString(t.amount, t.tokenDecimals),
      ...expectedReceivedAmountQuadForTransaction(t, recentExpectedByKey),
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
    ...ACTIVE,
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
      where: { ...uw, merchantId: mid, environment, ...ACTIVE },
      select: { id: true },
    });
    if (!owns) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const limRaw = req.query.limit;
    const limit =
      typeof limRaw === "string" && limRaw.trim() ? parseInt(limRaw, 10) : 200;
    const events = await loadUserAssignmentHistory(
      owns.id,
      Number.isFinite(limit) ? limit : 200,
    );
    res.json({
      user_id: owns.id,
      events,
      source_labels: {
        existing_session:
          "Same rail wallet refreshed (deposit-address)",
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
      where: { ...uw, merchantId: mid, environment, ...ACTIVE },
      select: { id: true },
    });
    if (!owns) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const limRaw = req.query.limit;
    const limit =
      typeof limRaw === "string" && limRaw.trim() ? parseInt(limRaw, 10) : 200;
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
    ...ACTIVE,
    ...(q
      ? {
          OR: [
            ...(/^\d+$/.test(q) ? [{ id: parseInt(q, 10) }] : []),
            { address: { contains: q, mode: "insensitive" } },
            {
              assignedUser: {
                is: {
                  ...ACTIVE,
                  externalUserId: { contains: q, mode: "insensitive" },
                },
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
      const deposit_scan_active = txCount > 0 || exp == null || exp > now;
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
        cached_balance_display: w.cachedBalanceDisplay ?? null,
        cached_balance_atomic: w.cachedBalanceAtomic ?? null,
        cached_balance_error: w.cachedBalanceError ?? null,
        cached_balance_updated_at: w.cachedBalanceUpdatedAt?.toISOString() ?? null,
      };
    }),
  });
});

router.get("/api/v1/merchant/wallets/refresh-balances/status", async (req, res) => {
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
  const s = getMerchantBulkWalletBalanceRefreshStatus(mid, gate.environment);
  res.json({
    running: s.running,
    total: s.lastResult?.total,
    ok: s.lastResult?.ok,
    failed: s.lastResult?.failed,
    error: s.lastError,
    scan_total: s.scanTotal,
    scan_processed: s.scanProcessed,
  });
});

router.post("/api/v1/merchant/wallets/refresh-balances", async (req, res) => {
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
  const started = startMerchantBulkWalletBalanceRefresh(mid, gate.environment);
  if (!started.started) {
    res.status(409).json({
      error: "refresh_in_progress",
      message:
        "A balance refresh is already running. Poll GET …/refresh-balances/status until it finishes.",
    });
    return;
  }
  res.status(202).json({
    accepted: true,
    message:
      "Balance refresh started in the background. Poll GET /api/v1/merchant/wallets/refresh-balances/status until running is false.",
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
      where: { ...ww, merchantId: mid, environment, ...ACTIVE },
      select: { id: true },
    });
    if (!owns) {
      res.status(404).json({ error: "wallet_not_found" });
      return;
    }
    const limRaw = req.query.limit;
    const limit =
      typeof limRaw === "string" && limRaw.trim() ? parseInt(limRaw, 10) : 100;
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
      typeof req.params.walletId === "string" ? req.params.walletId.trim() : "";
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
        ...ww,
        merchantId: mid,
        environment: MerchantGatewayEnv.live,
        ...ACTIVE,
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

/**
 * Same rules as POST /api/v1/admin/tool/send-usdt, but `from_address` must be a USDT deposit wallet for this merchant.
 */
router.post("/api/v1/merchant/tool/send-usdt", async (req, res) => {
  const mid = merchantId(req);
  if (!mid) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const from_address =
    typeof req.body?.from_address === "string"
      ? req.body.from_address
      : typeof req.body?.fromAddress === "string"
        ? req.body.fromAddress
        : "";
  const to_address =
    typeof req.body?.to_address === "string"
      ? req.body.to_address
      : typeof req.body?.toAddress === "string"
        ? req.body.toAddress
        : "";
  try {
    const result = await adminDirectionalUsdtSend({
      from_address,
      to_address,
      merchant_id: mid,
    });
    if (!result.ok) {
      const err = String(result.error ?? "");
      const status =
        err === "FROM_WALLET_NOT_FOUND" || err === "ambiguous_from" ? 404 : 400;
      return res.status(status).json(result);
    }
    res.json(result);
  } catch (e) {
    logger.error("merchant tool send-usdt failed", { err: String(e) });
    res.status(500).json({ error: "server_error", message: String(e) });
  }
});

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
  const qTxRef =
    typeof req.query.transaction_id === "string"
      ? req.query.transaction_id.trim()
      : "";

  const ledgerKind = parseLedgerKindQuery(req.query.ledger_kind);
  const useDepositOnlyPrismaPath =
    ledgerKind !== "payout" && (Boolean(qUser) || Boolean(qTxRef));

  /**
   * @param {import("@prisma/client").Transaction & { payerUser?: { externalUserId: string } | null, wallet: import("@prisma/client").Wallet & { assignedUser?: { externalUserId: string } | null } }} t
   * @param {Awaited<ReturnType<typeof loadExpectedAtomicByWalletSessionForTransactions>>} expectedByKey
   */
  const mapDepositRow = (t, expectedByKey) => ({
    id: t.id,
    transaction_id: t.referenceTransactionId ?? null,
    tx_hash: t.txHash,
    chain: t.chain,
    status: t.status,
    token_symbol: t.tokenSymbol,
    token_decimals: t.tokenDecimals,
    amount: t.amount,
    amount_decimal: formatAtomicAmountString(t.amount, t.tokenDecimals),
    ...requestedAmountFieldsForTransaction(t, expectedByKey),
    ...expectedReceivedAmountQuadForTransaction(t, expectedByKey),
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
      t.payerUser?.externalUserId ??
      t.wallet.assignedUser?.externalUserId ??
      null,
    gateway_environment: t.wallet.environment,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
  });

  if (!useDepositOnlyPrismaPath) {
    const unionParams = {
      merchantIds: [mid],
      environment,
      skip,
      take,
      chain,
      chainOk: !!(chain && CHAIN_SET.has(chain)),
      token,
      statusUi: status,
      qUser,
      qTxRef,
      qAddr: "",
      ledgerKind,
    };
    const totalMerged = await countMerchantLedgerUnion(prisma, unionParams);
    if (totalMerged !== null) {
      const unionRows = await fetchMerchantLedgerUnionPage(prisma, unionParams);
      const depIds = unionRows.filter((u) => u.entry_kind === "deposit").map((u) => u.entry_id);
      const payIds = unionRows.filter((u) => u.entry_kind === "payout").map((u) => u.entry_id);
      const [txRows, wdRows] = await Promise.all([
        depIds.length
          ? prisma.transaction.findMany({
              where: {
                id: { in: depIds },
                ...ACTIVE,
                wallet: {
                  is: {
                    merchantId: mid,
                    environment,
                    ...ACTIVE,
                  },
                },
              },
              include: {
                payerUser: { select: { externalUserId: true } },
                wallet: {
                  include: {
                    assignedUser: { select: { externalUserId: true } },
                  },
                },
              },
            })
          : [],
        payIds.length
          ? prisma.withdrawal.findMany({
              where: {
                id: { in: payIds },
                merchantId: mid,
                environment,
                ...ACTIVE,
              },
            })
          : [],
      ]);
      await fillMissingWithdrawalNetworkFees(wdRows);
      const tm = new Map(txRows.map((t) => [t.id, t]));
      const wm = new Map(wdRows.map((w) => [w.id, w]));
      const expectedByKeyMerge =
        await loadExpectedAtomicByWalletSessionForTransactions(txRows);
      const ledger = [];
      for (const ur of unionRows) {
        if (ur.entry_kind === "deposit") {
          const t = tm.get(ur.entry_id);
          if (!t) continue;
          ledger.push({
            kind: "deposit",
            created_at: t.createdAt,
            deposit: mapDepositRow(t, expectedByKeyMerge),
          });
        } else {
          const w = wm.get(ur.entry_id);
          if (!w) continue;
          ledger.push({
            kind: "payout",
            created_at: w.createdAt,
            payout: withdrawalPublicJson(w),
          });
        }
      }
      const transactions = ledger
        .filter((x) => x.kind === "deposit")
        .map((x) => x.deposit);
      res.json({
        page,
        pageSize,
        total: totalMerged,
        environment,
        ledger_kind: ledgerKind,
        ledger,
        transactions,
      });
      return;
    }
  }

  const where = {
    ...ACTIVE,
    wallet: {
      is: {
        merchantId: mid,
        environment,
        ...ACTIVE,
      },
    },
    ...(qUser
      ? {
          OR: [
            {
              payerUser: {
                is: {
                  ...ACTIVE,
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
                  ...ACTIVE,
                  assignedUser: {
                    is: {
                      ...ACTIVE,
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
    ...(qTxRef
      ? {
          referenceTransactionId: {
            contains: qTxRef,
            mode: "insensitive",
          },
        }
      : {}),
  };

  const rawListArgs = {
    mid,
    environment,
    chain,
    chainOk: !!(chain && CHAIN_SET.has(chain)),
    status,
    token,
    qUser,
    qTxRef,
  };

  const [total, rows] = await Promise.all(
    prismaClientKnowsTxStatusCreated()
      ? [
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
        ]
      : [
          countMerchantPortalTransactionsRaw(prisma, rawListArgs),
          listMerchantPortalTransactionsRaw(prisma, {
            ...rawListArgs,
            skip,
            take,
          }),
        ],
  );

  const expectedByKey =
    await loadExpectedAtomicByWalletSessionForTransactions(rows);

  const deposits = rows.map((t) => mapDepositRow(t, expectedByKey));
  const ledger = deposits.map((d) => ({
    kind: "deposit",
    created_at: d.created_at,
    deposit: d,
  }));

  res.json({
    page,
    pageSize,
    total,
    environment,
    ledger_kind: "deposit",
    ledger,
    transactions: deposits,
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
      ...(result.httpStatus != null
        ? { upstream_status: result.httpStatus }
        : {}),
      ...(result.bodySnippet
        ? { upstream_body_snippet: result.bodySnippet }
        : {}),
    });
  },
);

router.patch("/api/v1/merchant/settings", async (req, res) => {
  const mid = merchantId(req);
  if (!mid) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const body = req.body ?? {};
  const existing = await prisma.merchant.findFirst({
    where: { id: mid, ...ACTIVE },
    select: {
      defaultChains: true,
      defaultCurrency: true,
      defaultNetwork: true,
      supportedDepositRails: true,
      autoSwapEnabled: true,
      autoSwapSettingsJson: true,
      payoutMinAmountHuman: true,
      payoutMaxAmountHuman: true,
      payoutTreasuryAddressesJson: true,
      mdrPercent: true,
      settlementRatePercent: true,
      payoutMdrPercent: true,
    },
  });
  if (!existing) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const data = {};
  if (body.callback_url !== undefined) data.callbackUrl = body.callback_url;

  if (body.payout_mdr_percent !== undefined) {
    const p = parseFeePercent(body.payout_mdr_percent);
    if (p === null || !isValidFeePercent(p)) {
      res.status(400).json({ error: "invalid_payout_mdr_percent" });
      return;
    }
    data.payoutMdrPercent = p;
  }

  let nextChains = existing.defaultChains ?? [];
  if (body.default_chains !== undefined) {
    const parsedChains = parseDefaultChainsArray(body.default_chains, {
      minOne: true,
      ignoreGatewayTronUsdtOnly: true,
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
      { ignoreGatewayTronUsdtOnly: true },
    );
    if ("error" in pr) {
      res.status(400).json({ error: pr.error });
      return;
    }
    data.supportedDepositRails = pr.keys;
    nextSupported = pr.keys;
  } else if (nextSupported.length > 0) {
    const v = parseSupportedDepositRailsInput(nextSupported, nextChains, {
      ignoreGatewayTronUsdtOnly: true,
    });
    if ("error" in v) {
      res.status(400).json({ error: v.error });
      return;
    }
    nextSupported = v.keys;
  }

  const railsChanged =
    railsSortedKey(nextSupported) !== railsSortedKey(existing.supportedDepositRails);

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
    const picked = pickMerchantDefaultPair(
      pairBody,
      nextChains,
      constraintKeys,
    );
    if ("error" in picked && picked.error) {
      res.status(400).json({ error: picked.error });
      return;
    }
    data.defaultCurrency = picked.currency;
    data.defaultNetwork = picked.network;
  }

  /** Treasury / auto-swap / TRX funder / payout rails — managed by RP/admin later, not merchant portal. */
  const merchantForbiddenTreasuryKeys = [
    "auto_swap_enabled",
    "autoSwapEnabled",
    "auto_swap_settings",
    "autoSwapSettings",
    "payout_rails_policy",
    "payoutRailsPolicy",
    "payout_min_amount_human",
    "payout_max_amount_human",
    "payout_treasury_addresses",
    "payoutTreasuryAddresses",
    "trx_sweep_funder_private_key",
  ];
  for (const k of merchantForbiddenTreasuryKeys) {
    if (body[k] !== undefined) {
      res.status(403).json({
        error: "merchant_treasury_settings_forbidden",
        message:
          "Treasury, automatic swap, TRX funder, and payout rail defaults are not editable from the merchant portal.",
      });
      return;
    }
  }

  // Keep existing auto-swap destinations valid when deposit rails shrink (no merchant edits).
  if (railsChanged && existing.autoSwapEnabled === true) {
    const merged = mergeAutoSwapSettingsPayload(
      undefined,
      existing.autoSwapSettingsJson,
    );
    const v = validateMerchantAutoSwapState(
      merged,
      nextSupported,
      existing.autoSwapEnabled,
    );
    if (!v.ok) {
      res.status(400).json({
        error: v.error,
        message:
          v.message ??
          "Supported rails changed in a way that breaks existing auto-swap settings. Contact your partner/admin.",
        ...(v.rail_key ? { rail_key: v.rail_key } : {}),
      });
      return;
    }
    data.autoSwapSettingsJson = v.json;
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
  const merchRates = await prisma.merchant.findFirst({
    where: { id: mid, ...ACTIVE },
    select: {
      id: true,
      mdrPercent: true,
      payoutMdrPercent: true,
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
      payout_mdr_percent: Number(merchRates.payoutMdrPercent),
      settlement_rate_percent: Number(merchRates.settlementRatePercent),
      min_settlement_amount: merchRates.minSettlementAmount,
      settlement_period_days: Number(merchRates.settlementPeriodDays ?? 0),
    },
    buckets,
  });
});

router.get("/api/v1/merchant/settlements/payout-preview", async (req, res) => {
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
  const merchRates = await prisma.merchant.findFirst({
    where: { id: mid, ...ACTIVE },
    select: {
      id: true,
      payoutMdrPercent: true,
    },
  });
  if (!merchRates) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const buckets = await buildPendingPayoutPreviewBuckets(mid, environment, {
    payoutMdrPercent: merchRates.payoutMdrPercent,
  });
  res.json({
    environment,
    fee_rates: {
      payout_mdr_percent: Number(merchRates.payoutMdrPercent),
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
  const where = { merchantId: mid, environment, ...ACTIVE };
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
    where: { ...sw, merchantId: mid, ...ACTIVE },
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
