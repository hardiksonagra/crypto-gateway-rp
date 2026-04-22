import { Router } from "express";
import bcrypt from "bcrypt";
import {
  Chain,
  MerchantGatewayEnv,
  Prisma,
  TxStatus,
  WithdrawalStatus,
} from "@prisma/client";
import {
  PORTAL_ROLE_ADMIN,
  PORTAL_ROLE_MERCHANT,
} from "../constants/portal-role.js";
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
import { prisma } from "../lib/prisma.js";
import {
  countAdminTransactionsListRaw,
  listAdminTransactionsListRaw,
} from "../lib/admin-transactions-list-raw.js";
import { prismaClientKnowsTxStatusCreated } from "../lib/prisma-tx-status.js";
import { signAuthToken } from "../lib/auth-jwt.js";
import { requireAuth } from "../middleware/require-auth.js";
import { logPanelMutations } from "../middleware/log-panel-mutations.js";
import { parsePageQuery } from "../lib/pagination.js";
import { generateApiKey, hashApiKey } from "../lib/api-key.js";
import { encryptMerchantApiKey } from "../lib/merchant-api-key-cipher.js";
import { logger } from "../lib/logger.js";
import { re } from "../config/runtime-env.js";
import {
  applyAppSettingsPatch,
  buildAppSettingsAdminList,
  loadAppSettingsFromDatabase,
  upsertAppSettingKeyValue,
} from "../lib/app-settings-runtime.js";
import { ACTIVE } from "../lib/active-row.js";
import {
  ADMIN_CHAIN_TOGGLE_ORDER,
  CHAIN_ADMIN_META,
  isChainLiveForPlatform,
  listMerchantSelectableChainsForAdmin,
  serializeChainEnabledFromAdminInput,
} from "../lib/chain-enable.js";
import {
  merchantWhereFromRouteParam,
  merchantSettlementWhereFromRouteParam,
  resolveMerchantInternalId,
  userWhereFromRouteParam,
  walletWhereFromRouteParam,
} from "../lib/entity-internal-id.js";
import { parseDefaultChainsArray } from "../lib/default-chains.js";
import { depositRailKey } from "../config/payment-rails.js";
import {
  parseSupportedDepositRailsInput,
  pickMerchantDefaultPair,
} from "../lib/merchant-default-pair.js";
import { pruneMerchantsAfterSupportedChainsChange } from "../lib/prune-merchants-after-supported-chains-change.js";
import { redeliverPaymentSuccessWebhookAdmin } from "../services/callback-service.js";
import { adminRescanTronDepositForTransaction } from "../services/admin-tron-deposit-rescan.js";
import { refreshAllWalletCachedBalances } from "../services/wallet/wallet-balance-probe.js";
import { listWalletsUniqueByOnChainIdentity } from "../lib/admin-wallets-unique-address-list.js";
import {
  aggregateWalletTxStats,
  loadWalletDepositActivity,
} from "../lib/wallet-deposit-stats.js";
import {
  lastNDatesInZone,
  sanitizeIanaTimeZone,
} from "../lib/ianaTimeZone.js";
import {
  batchUserAssignmentStats,
  batchUserPayerTxStats,
  loadUserAssignmentHistory,
  loadUserPayerDepositHistory,
} from "../lib/user-portal-stats.js";
import {
  listTronUsdtSweepTargets,
  sweepTronUsdtAll,
  sweepTronUsdtOne,
} from "../services/sweep/tron-usdt-sweep.js";
import {
  listEvmUsdtSweepTargets,
  sweepEvmUsdtAll,
  sweepEvmUsdtOne,
} from "../services/sweep/evm-usdt-sweep.js";
import {
  listUnifiedSweepTargets,
  sweepUnifiedAll,
  sweepUnifiedOne,
} from "../services/sweep/unified-sweep.js";
import { adminDirectionalUsdtSend } from "../services/sweep/admin-directional-usdt-send.js";
import crypto from "crypto";
import fs from "fs";
import {
  isValidFeePercent,
  parseFeePercent,
  parseSettlementPeriodDays,
  validateAndNormalizeHumanMinSettlement,
} from "../lib/merchant-fee-math.js";
import {
  proofPathForFileName,
  settlementProofUpload,
} from "../lib/settlement-upload.js";
import { computeMerchantBalances } from "../services/merchant-balance.js";
import {
  buildAllPendingPreviews,
  executeBatchSettlement,
} from "../services/settlement-batch.js";

const router = Router();
const adminOnly = requireAuth(PORTAL_ROLE_ADMIN);

const CHAINS = new Set(Object.values(Chain));

/**
 * @param {string} routeId
 */
async function findMerchantByAdminRouteId(routeId) {
  const w = merchantWhereFromRouteParam(routeId);
  if (!w) return null;
  return prisma.merchant.findFirst({ where: w });
}

/**
 * @param {string} routeId
 */
async function findUserByAdminRouteId(routeId) {
  const w = userWhereFromRouteParam(routeId);
  if (!w) return null;
  return prisma.user.findFirst({ where: { ...w, ...ACTIVE } });
}

/**
 * @param {string} routeId
 */
async function findWalletByAdminRouteId(routeId) {
  const w = walletWhereFromRouteParam(routeId);
  if (!w) return null;
  return prisma.wallet.findFirst({ where: { ...w, ...ACTIVE } });
}

router.use("/api/v1/admin", adminOnly, logPanelMutations("admin"));

/**
 * Global Users / Transactions lists respect this admin's saved `portal_environment`.
 *
 * @param {{ auth?: { sub?: string } }} req
 * @returns {Promise<import("@prisma/client").MerchantGatewayEnv>}
 */
async function adminListViewerEnvironment(req) {
  const id = req.auth?.sub;
  if (!id) return MerchantGatewayEnv.live;
  const aw = merchantWhereFromRouteParam(id);
  if (!aw) return MerchantGatewayEnv.live;
  const row = await prisma.admin.findFirst({
    where: aw,
    select: { portalEnvironment: true },
  });
  if (!row) return MerchantGatewayEnv.live;
  return row.portalEnvironment === MerchantGatewayEnv.sandbox
    ? MerchantGatewayEnv.sandbox
    : MerchantGatewayEnv.live;
}

router.get("/api/v1/admin/dashboard", async (req, res) => {
  const listEnv = await adminListViewerEnvironment(req);
  const txEnvWhere = {
    wallet: { is: { environment: listEnv } },
  };

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const viewerTz = sanitizeIanaTimeZone(req.query.tz) ?? "UTC";
  const tzSql = `'${viewerTz.replace(/'/g, "''")}'`;
  const dayKeys = lastNDatesInZone(14, viewerTz);
  const wideFrom = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);

  const byStatusPromise = prismaClientKnowsTxStatusCreated()
    ? prisma.transaction.groupBy({
        by: ["status"],
        where: { ...txEnvWhere, ...ACTIVE },
        _count: { _all: true },
      })
    : prisma.$queryRaw(
        Prisma.sql`
          SELECT t.status::text AS status, COUNT(*)::int AS cnt
          FROM transactions t
          INNER JOIN wallets w ON w.id = t.wallet_id
          WHERE w.environment = ${listEnv}::"MerchantGatewayEnv"
            AND w.deleted_at IS NULL
            AND t.deleted_at IS NULL
          GROUP BY t.status
        `,
      ).then((rows) =>
        rows.map((r) => ({
          status: r.status,
          _count: { _all: Number(r.cnt) },
        })),
      );

  const [
    merchants,
    users,
    txs,
    successTxs,
    txs24h,
    walletsInEnv,
    byStatus,
    byChain,
    dailyStatusRows,
  ] = await Promise.all([
    prisma.merchant.count({
      where: { deletedAt: null },
    }),
    prisma.user.count({ where: { environment: listEnv, ...ACTIVE } }),
    prisma.transaction.count({ where: { ...txEnvWhere, ...ACTIVE } }),
    prisma.transaction.count({
      where: { ...txEnvWhere, ...ACTIVE, status: TxStatus.success },
    }),
    prisma.transaction.count({
      where: {
        ...txEnvWhere,
        ...ACTIVE,
        createdAt: { gte: since },
      },
    }),
    prisma.wallet.count({ where: { environment: listEnv, ...ACTIVE } }),
    byStatusPromise,
    prisma.transaction.groupBy({
      by: ["chain"],
      where: { ...txEnvWhere, ...ACTIVE },
      _count: { _all: true },
    }),
    prisma.$queryRaw(
      Prisma.sql`
        SELECT ((t.created_at AT TIME ZONE ${Prisma.raw(tzSql)}))::date AS day,
               t.status::text AS status,
               COUNT(*)::int AS cnt
        FROM transactions t
        INNER JOIN wallets w ON w.id = t.wallet_id
        WHERE w.environment = ${listEnv}::"MerchantGatewayEnv"
          AND w.deleted_at IS NULL
          AND t.deleted_at IS NULL
          AND t.created_at >= ${wideFrom}
        GROUP BY 1, 2
        ORDER BY 1, 2
      `,
    ),
  ]);

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
    else if (st === "success") bucket.success = c;
    else if (st === "failed") bucket.failed = c;
    else if (st === "underpaid") bucket.underpaid = c;
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

  res.json({
    viewer_environment: listEnv,
    merchants,
    end_users: users,
    transactions_total: txs,
    transactions_success: successTxs,
    transactions_last_24h: txs24h,
    wallets_in_env: walletsInEnv,
    transactions_by_status: byStatus.map((r) => ({
      status: r.status,
      count: r._count._all,
    })),
    transactions_by_chain: byChain
      .map((r) => ({
        chain: r.chain,
        count: r._count._all,
      }))
      .sort((a, b) => b.count - a.count),
    transactions_daily_by_status,
  });
});

router.get("/api/v1/admin/audit-logs", async (req, res) => {
  const { skip, take, page, pageSize } = parsePageQuery(req.query);
  const merchantId =
    typeof req.query.merchant_id === "string"
      ? req.query.merchant_id.trim()
      : "";
  const source =
    typeof req.query.source === "string" ? req.query.source.trim() : "";
  const action =
    typeof req.query.action === "string" ? req.query.action.trim() : "";
  const from =
    typeof req.query.created_from === "string"
      ? new Date(req.query.created_from)
      : null;
  const to =
    typeof req.query.created_to === "string"
      ? new Date(req.query.created_to)
      : null;

  const createdAt = {};
  if (from && !Number.isNaN(from.getTime())) createdAt.gte = from;
  if (to && !Number.isNaN(to.getTime())) createdAt.lte = to;

  const auditMerch = merchantId
    ? merchantWhereFromRouteParam(merchantId)
    : null;
  const where = {
    ...(merchantId
      ? auditMerch
        ? { merchant: auditMerch }
        : { id: { in: [] } }
      : {}),
    ...(source ? { source } : {}),
    ...(action
      ? { action: { contains: action, mode: Prisma.QueryMode.insensitive } }
      : {}),
    ...(Object.keys(createdAt).length ? { createdAt } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
  ]);

  const mids = [...new Set(rows.map((r) => r.merchantId).filter(Boolean))];
  const merchants =
    mids.length > 0
      ? await prisma.merchant.findMany({
          where: { id: { in: mids } },
          select: { id: true, email: true },
        })
      : [];
  const emailById = Object.fromEntries(merchants.map((m) => [m.id, m.email]));

  res.json({
    total,
    page,
    pageSize,
    logs: rows.map((r) => ({
      id: r.id,
      created_at: r.createdAt,
      source: r.source,
      action: r.action,
      merchant_id: r.merchantId,
      merchant_email: r.merchantId ? emailById[r.merchantId] ?? null : null,
      actor_type: r.actorType,
      actor_id: r.actorId,
      actor_email: r.actorEmail,
      summary: r.summary,
      request_method: r.requestMethod,
      request_path: r.requestPath,
      ip_address: r.ipAddress,
      metadata: r.metadata,
    })),
  });
});

router.get("/api/v1/admin/panel-audit-logs", async (req, res) => {
  const { skip, take, page, pageSize } = parsePageQuery(req.query);
  const panelRaw =
    typeof req.query.panel === "string" ? req.query.panel.trim().toLowerCase() : "";
  const panel =
    panelRaw === "admin" || panelRaw === "merchant" ? panelRaw : "";
  const merchantId =
    typeof req.query.merchant_id === "string"
      ? req.query.merchant_id.trim()
      : "";
  const actorId =
    typeof req.query.actor_id === "string" ? req.query.actor_id.trim() : "";
  const pathQ =
    typeof req.query.path === "string" ? req.query.path.trim() : "";
  const from =
    typeof req.query.created_from === "string"
      ? new Date(req.query.created_from)
      : null;
  const to =
    typeof req.query.created_to === "string"
      ? new Date(req.query.created_to)
      : null;

  const createdAt = {};
  if (from && !Number.isNaN(from.getTime())) createdAt.gte = from;
  if (to && !Number.isNaN(to.getTime())) {
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);
    createdAt.lte = end;
  }

  const where = {
    ...(panel ? { panel } : {}),
    ...(merchantId ? { targetMerchantId: merchantId } : {}),
    ...(actorId ? { actorId } : {}),
    ...(pathQ
      ? { path: { contains: pathQ, mode: Prisma.QueryMode.insensitive } }
      : {}),
    ...(Object.keys(createdAt).length ? { createdAt } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.panelAuditLog.count({ where }),
    prisma.panelAuditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
  ]);

  const actorIds = [...new Set(rows.map((r) => r.actorId))];
  const targetIds = [
    ...new Set(rows.map((r) => r.targetMerchantId).filter(Boolean)),
  ];
  const allUserIds = [...new Set([...actorIds, ...targetIds])];
  const numericIds = allUserIds
    .filter((x) => /^\d+$/.test(x))
    .map((x) => parseInt(x, 10));
  let users = [];
  if (numericIds.length > 0) {
    const [adminRows, merchantRows] = await Promise.all([
      prisma.admin.findMany({
        where: { id: { in: numericIds } },
        select: { id: true, email: true },
      }),
      prisma.merchant.findMany({
        where: { id: { in: numericIds } },
        select: { id: true, email: true },
      }),
    ]);
    users = [...adminRows, ...merchantRows];
  }
  /** @type {Record<string, string>} */
  const emailById = {};
  for (const u of users) {
    emailById[String(u.id)] = u.email;
  }

  res.json({
    total,
    page,
    pageSize,
    logs: rows.map((r) => ({
      id: r.id,
      created_at: r.createdAt,
      panel: r.panel,
      method: r.method,
      path: r.path,
      http_status: r.httpStatus,
      actor_id: r.actorId,
      actor_role: r.actorRole,
      actor_email: emailById[r.actorId] ?? null,
      target_merchant_id: r.targetMerchantId,
      target_merchant_email: r.targetMerchantId
        ? emailById[r.targetMerchantId] ?? null
        : null,
      summary: r.summary,
      ip_address: r.ipAddress,
      metadata: r.metadata,
    })),
  });
});

router.get("/api/v1/admin/merchants", async (req, res) => {
  const { skip, take, page, pageSize } = parsePageQuery(req.query);
  const search =
    typeof req.query.search === "string" ? req.query.search.trim() : "";
  const isActive =
    req.query.is_active === "true"
      ? true
      : req.query.is_active === "false"
        ? false
        : undefined;

  /** open (default) = not soft-deleted; all = include deleted; deleted = only soft-deleted */
  const listScope =
    typeof req.query.list_scope === "string" ? req.query.list_scope.trim() : "";
  const deletedClause =
    listScope === "all"
      ? {}
      : listScope === "deleted"
        ? { deletedAt: { not: null } }
        : { deletedAt: null };

  const where = {
    ...deletedClause,
    ...(typeof isActive === "boolean" ? { isActive } : {}),
    ...(search
      ? {
          OR: [
            { email: { contains: search, mode: "insensitive" } },
            { displayName: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.merchant.count({ where }),
    prisma.merchant.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: {
        id: true,
        email: true,
        displayName: true,
        defaultChains: true,
        defaultCurrency: true,
        defaultNetwork: true,
        supportedDepositRails: true,
        callbackUrl: true,
        apiKeyHash: true,
        apiKeyHint: true,
        sandboxApiKeyHint: true,
        isActive: true,
        deletedAt: true,
        liveGatewayEnabled: true,
        sandboxGatewayEnabled: true,
        portalEnvironment: true,
        createdAt: true,
        mdrPercent: true,
        settlementRatePercent: true,
        minSettlementAmount: true,
        settlementPeriodDays: true,
      },
    }),
  ]);

  const ids = rows.map((r) => r.id);
  /** @type {Map<string, number>} */
  const liveUserCounts = new Map();
  /** @type {Map<string, number>} */
  const sandboxUserCounts = new Map();
  if (ids.length > 0) {
    const [liveG, sandG] = await Promise.all([
      prisma.user.groupBy({
        by: ["merchantId"],
        where: {
          merchantId: { in: ids },
          environment: MerchantGatewayEnv.live,
          ...ACTIVE,
        },
        _count: { _all: true },
      }),
      prisma.user.groupBy({
        by: ["merchantId"],
        where: {
          merchantId: { in: ids },
          environment: MerchantGatewayEnv.sandbox,
          ...ACTIVE,
        },
        _count: { _all: true },
      }),
    ]);
    for (const r of liveG) liveUserCounts.set(r.merchantId, r._count._all);
    for (const r of sandG) sandboxUserCounts.set(r.merchantId, r._count._all);
  }

  res.json({
    page,
    pageSize,
    total,
    merchants: rows.map((m) => ({
      id: m.id,
      email: m.email,
      display_name: m.displayName,
      default_chains: m.defaultChains,
      default_currency: m.defaultCurrency,
      default_network: m.defaultNetwork,
      supported_deposit_rails: m.supportedDepositRails ?? [],
      callback_url: m.callbackUrl,
      api_key_hash: m.apiKeyHash,
      api_key_hint: m.apiKeyHint,
      sandbox_api_key_hint: m.sandboxApiKeyHint,
      is_active: m.isActive,
      deleted_at: m.deletedAt,
      live_gateway_enabled: m.liveGatewayEnabled,
      sandbox_gateway_enabled: m.sandboxGatewayEnabled,
      portal_environment: m.portalEnvironment,
      created_at: m.createdAt,
      mdr_percent: Number(m.mdrPercent),
      settlement_rate_percent: Number(m.settlementRatePercent),
      min_settlement_amount: m.minSettlementAmount,
      settlement_period_days: m.settlementPeriodDays,
      end_users_live: liveUserCounts.get(m.id) ?? 0,
      end_users_sandbox: sandboxUserCounts.get(m.id) ?? 0,
    })),
  });
});

router.post("/api/v1/admin/merchants", async (req, res) => {
  const body = req.body ?? {};
  const email = body.email?.trim().toLowerCase();
  if (!email) {
    res.status(400).json({ error: "email required" });
    return;
  }
  const parsedChains = parseDefaultChainsArray(body.default_chains, {
    minOne: true,
    ignoreGatewayTronUsdtOnly: true,
  });
  if ("error" in parsedChains && parsedChains.error) {
    res.status(400).json({ error: parsedChains.error });
    return;
  }
  let constraintKeys = null;
  let supportedKeysToStore;
  if (body.supported_deposit_rails !== undefined) {
    const pr = parseSupportedDepositRailsInput(
      body.supported_deposit_rails,
      parsedChains.chains,
      { ignoreGatewayTronUsdtOnly: true },
    );
    if ("error" in pr) {
      res.status(400).json({ error: pr.error });
      return;
    }
    constraintKeys = pr.keys;
    supportedKeysToStore = pr.keys;
  }
  const picked = pickMerchantDefaultPair(
    body,
    parsedChains.chains,
    constraintKeys,
  );
  if ("error" in picked && picked.error) {
    res.status(400).json({ error: picked.error });
    return;
  }
  if (supportedKeysToStore === undefined) {
    supportedKeysToStore = [depositRailKey(picked.currency, picked.network)];
  }
  const password =
    body.password?.trim() || crypto.randomBytes(12).toString("base64url");
  const apiSecret = generateApiKey();

  const mdrP = parseFeePercent(body.mdr_percent);
  const settlementP = parseFeePercent(body.settlement_rate_percent);
  if (mdrP === null || settlementP === null) {
    res.status(400).json({ error: "invalid_fee_percent" });
    return;
  }
  if (!isValidFeePercent(mdrP) || !isValidFeePercent(settlementP)) {
    res.status(400).json({
      error: "fee_percent_range",
      message: "MDR and settlement rate must be between 0 and 100.",
    });
    return;
  }
  if (mdrP + settlementP > 100) {
    res.status(400).json({
      error: "fee_percent_sum",
      message: "MDR + settlement rate cannot exceed 100%.",
    });
    return;
  }

  const minSettle = validateAndNormalizeHumanMinSettlement(body.min_settlement_amount);
  if (!minSettle.ok) {
    res.status(400).json({
      error: "invalid_min_settlement_amount",
      message: minSettle.error,
    });
    return;
  }

  const periodDays = parseSettlementPeriodDays(body.settlement_period_days);
  if (periodDays === null) {
    res.status(400).json({
      error: "invalid_settlement_period_days",
      message: "Use a whole number of days from 0 to 3650.",
    });
    return;
  }

  try {
    const row = await prisma.merchant.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(password, 10),
        displayName: body.display_name?.trim() || null,
        defaultChains: parsedChains.chains,
        defaultCurrency: picked.currency,
        defaultNetwork: picked.network,
        supportedDepositRails: supportedKeysToStore,
        callbackUrl: body.callback_url?.trim() || null,
        apiKeyHash: hashApiKey(apiSecret),
        apiKeyHint: apiSecret.slice(-6),
        apiKeyCipher: encryptMerchantApiKey(apiSecret),
        sandboxApiKeyHash: hashApiKey(apiSecret),
        sandboxApiKeyHint: apiSecret.slice(-6),
        sandboxApiKeyCipher: encryptMerchantApiKey(apiSecret),
        mdrPercent: mdrP,
        settlementRatePercent: settlementP,
        minSettlementAmount: minSettle.raw,
        settlementPeriodDays: periodDays,
        ...(typeof body.live_gateway_enabled === "boolean"
          ? { liveGatewayEnabled: body.live_gateway_enabled }
          : {}),
        ...(typeof body.sandbox_gateway_enabled === "boolean"
          ? { sandboxGatewayEnabled: body.sandbox_gateway_enabled }
          : {}),
      },
    });
    res.status(201).json({
      id: row.id,
      email: row.email,
      display_name: row.displayName,
      portal_environment: row.portalEnvironment,
      default_chains: row.defaultChains,
      default_currency: row.defaultCurrency,
      default_network: row.defaultNetwork,
      supported_deposit_rails: row.supportedDepositRails ?? [],
      callback_url: row.callbackUrl,
      mdr_percent: Number(row.mdrPercent),
      settlement_rate_percent: Number(row.settlementRatePercent),
      min_settlement_amount: row.minSettlementAmount,
      settlement_period_days: row.settlementPeriodDays,
      temporary_password: body.password?.trim() ? undefined : password,
      api_key: apiSecret,
      sandbox_api_key: apiSecret,
      message:
        "One gateway secret (cpg_…) for live and sandbox: gateway calls use the merchant portal environment (Settings) by default; optional JSON gateway_environment overrides when needed. The merchant can view the key in the portal while logged in.",
    });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      res.status(409).json({ error: "email_already_exists" });
      return;
    }
    logger.error("admin create merchant", { err: String(e) });
    res.status(500).json({ error: "internal error" });
  }
});

router.patch("/api/v1/admin/merchants/:id", async (req, res) => {
  const id = String(req.params.id ?? "");
  const body = req.body ?? {};
  const existing = await findMerchantByAdminRouteId(id);
  if (!existing) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (existing.deletedAt) {
    res.status(400).json({
      error: "merchant_deleted",
      message: "This merchant is soft-deleted and cannot be edited.",
    });
    return;
  }

  let newApiKey;
  let newSandboxApiKey;
  const data = {};
  if (body.display_name !== undefined) data.displayName = body.display_name;
  if (body.callback_url !== undefined) data.callbackUrl = body.callback_url;
  if (typeof body.is_active === "boolean") data.isActive = body.is_active;
  if (typeof body.live_gateway_enabled === "boolean") {
    data.liveGatewayEnabled = body.live_gateway_enabled;
  }
  if (typeof body.sandbox_gateway_enabled === "boolean") {
    data.sandboxGatewayEnabled = body.sandbox_gateway_enabled;
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
  if (body.password?.trim()) {
    data.passwordHash = await bcrypt.hash(body.password.trim(), 10);
  }

  let nextMdr = Number(existing.mdrPercent);
  let nextSettlement = Number(existing.settlementRatePercent);
  if (body.mdr_percent !== undefined) {
    const p = parseFeePercent(body.mdr_percent);
    if (p === null || !isValidFeePercent(p)) {
      res.status(400).json({
        error: "invalid_fee_percent",
        message: "MDR must be a number from 0 to 100.",
      });
      return;
    }
    nextMdr = p;
    data.mdrPercent = p;
  }
  if (body.settlement_rate_percent !== undefined) {
    const p = parseFeePercent(body.settlement_rate_percent);
    if (p === null || !isValidFeePercent(p)) {
      res.status(400).json({
        error: "invalid_fee_percent",
        message: "Settlement rate must be a number from 0 to 100.",
      });
      return;
    }
    nextSettlement = p;
    data.settlementRatePercent = p;
  }
  const feeFieldsInBody =
    body.mdr_percent !== undefined || body.settlement_rate_percent !== undefined;
  if (feeFieldsInBody && nextMdr + nextSettlement > 100) {
    res.status(400).json({
      error: "fee_percent_sum",
      message: "MDR + settlement rate cannot exceed 100%.",
    });
    return;
  }

  if (body.min_settlement_amount !== undefined) {
    const m = validateAndNormalizeHumanMinSettlement(body.min_settlement_amount);
    if (!m.ok) {
      res.status(400).json({
        error: "invalid_min_settlement_amount",
        message: m.error,
      });
      return;
    }
    data.minSettlementAmount = m.raw;
  }

  if (body.settlement_period_days !== undefined) {
    const pd = parseSettlementPeriodDays(body.settlement_period_days);
    if (pd === null) {
      res.status(400).json({
        error: "invalid_settlement_period_days",
        message: "Use a whole number of days from 0 to 3650.",
      });
      return;
    }
    data.settlementPeriodDays = pd;
  }

  if (body.regenerate_api_key || body.regenerate_sandbox_api_key) {
    const k = generateApiKey();
    newApiKey = k;
    newSandboxApiKey = k;
    data.apiKeyHash = hashApiKey(k);
    data.apiKeyHint = k.slice(-6);
    data.apiKeyCipher = encryptMerchantApiKey(k);
    data.sandboxApiKeyHash = data.apiKeyHash;
    data.sandboxApiKeyHint = data.apiKeyHint;
    data.sandboxApiKeyCipher = data.apiKeyCipher;
  }

  const row = await prisma.merchant.update({
    where: { id: existing.id },
    data,
    select: {
      id: true,
      email: true,
      displayName: true,
      defaultChains: true,
      defaultCurrency: true,
      defaultNetwork: true,
      supportedDepositRails: true,
      callbackUrl: true,
      apiKeyHint: true,
      sandboxApiKeyHint: true,
      isActive: true,
      liveGatewayEnabled: true,
      sandboxGatewayEnabled: true,
      mdrPercent: true,
      settlementRatePercent: true,
      minSettlementAmount: true,
      settlementPeriodDays: true,
    },
  });
  let message;
  if (newApiKey) {
    message =
      "New gateway API key returned once (live + sandbox use the same secret); merchant can view it in the portal.";
  }
  res.json({
    id: row.id,
    email: row.email,
    display_name: row.displayName,
    default_chains: row.defaultChains,
    default_currency: row.defaultCurrency,
    default_network: row.defaultNetwork,
    supported_deposit_rails: row.supportedDepositRails ?? [],
    callback_url: row.callbackUrl,
    api_key_hint: row.apiKeyHint,
    sandbox_api_key_hint: row.sandboxApiKeyHint,
    is_active: row.isActive,
    live_gateway_enabled: row.liveGatewayEnabled,
    sandbox_gateway_enabled: row.sandboxGatewayEnabled,
    mdr_percent: Number(row.mdrPercent),
    settlement_rate_percent: Number(row.settlementRatePercent),
    min_settlement_amount: row.minSettlementAmount,
    settlement_period_days: row.settlementPeriodDays,
    api_key: newApiKey,
    sandbox_api_key: newSandboxApiKey,
    message,
  });
});

router.get("/api/v1/admin/merchants/:id", async (req, res) => {
  const id = String(req.params.id ?? "");
  const mw = merchantWhereFromRouteParam(id);
  if (!mw) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const row = await prisma.merchant.findFirst({
    where: mw,
    select: {
      id: true,
      email: true,
      displayName: true,
      defaultChains: true,
      defaultCurrency: true,
      defaultNetwork: true,
      supportedDepositRails: true,
      callbackUrl: true,
      apiKeyHint: true,
      sandboxApiKeyHint: true,
      isActive: true,
      deletedAt: true,
      liveGatewayEnabled: true,
      sandboxGatewayEnabled: true,
      portalEnvironment: true,
      createdAt: true,
      mdrPercent: true,
      settlementRatePercent: true,
      minSettlementAmount: true,
      settlementPeriodDays: true,
    },
  });
  if (!row) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const [endUsersLive, endUsersSandbox] = await Promise.all([
    prisma.user.count({
      where: {
        merchantId: row.id,
        environment: MerchantGatewayEnv.live,
        ...ACTIVE,
      },
    }),
    prisma.user.count({
      where: {
        merchantId: row.id,
        environment: MerchantGatewayEnv.sandbox,
        ...ACTIVE,
      },
    }),
  ]);
  res.json({
    id: row.id,
    email: row.email,
    display_name: row.displayName,
    default_chains: row.defaultChains,
    default_currency: row.defaultCurrency,
    default_network: row.defaultNetwork,
    supported_deposit_rails: row.supportedDepositRails ?? [],
    callback_url: row.callbackUrl,
    api_key_hint: row.apiKeyHint,
    sandbox_api_key_hint: row.sandboxApiKeyHint,
    is_active: row.isActive,
    deleted_at: row.deletedAt,
    live_gateway_enabled: row.liveGatewayEnabled,
    sandbox_gateway_enabled: row.sandboxGatewayEnabled,
    portal_environment: row.portalEnvironment,
    created_at: row.createdAt,
    mdr_percent: Number(row.mdrPercent),
    settlement_rate_percent: Number(row.settlementRatePercent),
    min_settlement_amount: row.minSettlementAmount,
    settlement_period_days: row.settlementPeriodDays,
    end_users_live: endUsersLive,
    end_users_sandbox: endUsersSandbox,
    platform_enabled_chains: listMerchantSelectableChainsForAdmin(re.chainEnabledRecord),
  });
});

/** Admin-only: issue a portal JWT for the merchant (same shape as POST /auth/login). */
router.post("/api/v1/admin/merchants/:id/impersonate", async (req, res) => {
  const id = String(req.params.id ?? "");
  const mw = merchantWhereFromRouteParam(id);
  if (!mw) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const row = await prisma.merchant.findFirst({
    where: {
      AND: [mw, { deletedAt: null }],
    },
    select: {
      id: true,
      email: true,
      displayName: true,
      isActive: true,
    },
  });
  if (!row) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (!row.isActive) {
    res.status(403).json({ error: "merchant_inactive" });
    return;
  }
  const token = signAuthToken({ sub: String(row.id), role: PORTAL_ROLE_MERCHANT });
  res.json({
    token,
    role: PORTAL_ROLE_MERCHANT,
    email: row.email,
    display_name: row.displayName,
  });
});

router.delete("/api/v1/admin/merchants/:id", async (req, res) => {
  const id = String(req.params.id ?? "");
  const hit = await findMerchantByAdminRouteId(id);
  if (!hit) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (hit.deletedAt) {
    res.status(400).json({ error: "already_deleted" });
    return;
  }
  await prisma.merchant.update({
    where: { id: hit.id },
    data: { deletedAt: new Date(), isActive: false },
  });
  res.json({ ok: true });
});

router.get("/api/v1/admin/users", async (req, res) => {
  const { skip, take, page, pageSize } = parsePageQuery(req.query);
  const listEnv = await adminListViewerEnvironment(req);
  const merchantId =
    typeof req.query.merchant_id === "string"
      ? req.query.merchant_id.trim()
      : "";
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const from =
    typeof req.query.created_from === "string"
      ? new Date(req.query.created_from)
      : null;
  const to =
    typeof req.query.created_to === "string"
      ? new Date(req.query.created_to)
      : null;

  const merchantClause = merchantId
    ? merchantWhereFromRouteParam(merchantId)
    : null;
  const where = {
    environment: listEnv,
    ...ACTIVE,
    ...(merchantId
      ? merchantClause
        ? { merchant: merchantClause }
        : { id: { in: [] } }
      : {}),
    ...(q
      ? {
          OR: [
            { externalUserId: { contains: q, mode: "insensitive" } },
            ...(/^\d+$/.test(q)
              ? [{ id: parseInt(q, 10) }]
              : []),
          ],
        }
      : {}),
    ...(from && !Number.isNaN(from.getTime())
      ? { createdAt: { gte: from } }
      : {}),
    ...(to && !Number.isNaN(to.getTime()) ? { createdAt: { lte: to } } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        merchant: { select: { id: true, email: true, displayName: true } },
        _count: { select: { assignedWallets: true } },
      },
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
    viewer_environment: listEnv,
    users: rows.map((u) => {
      const asg = assignStats.get(u.id);
      const pay = payerStats.get(u.id);
      return {
        id: u.id,
        external_user_id: u.externalUserId,
        merchant: u.merchant,
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
  "/api/v1/admin/users/:userId/wallet-assignment-history",
  async (req, res) => {
    const userId =
      typeof req.params.userId === "string" ? req.params.userId.trim() : "";
    if (!userId) {
      res.status(400).json({ error: "user_id_required" });
      return;
    }
    const listEnv = await adminListViewerEnvironment(req);
    const merchantFilter =
      typeof req.query.merchant_id === "string"
        ? req.query.merchant_id.trim()
        : "";
    const uw = userWhereFromRouteParam(userId);
    if (!uw) {
      res.status(400).json({ error: "user_id_required" });
      return;
    }
    const u = await prisma.user.findFirst({
      where: { ...uw, environment: listEnv, ...ACTIVE },
      select: { id: true, merchantId: true },
    });
    if (!u) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const mfInt = merchantFilter
      ? await resolveMerchantInternalId(merchantFilter)
      : null;
    if (merchantFilter && mfInt != null && u.merchantId !== mfInt) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const limRaw = req.query.limit;
    const limit =
      typeof limRaw === "string" && limRaw.trim()
        ? parseInt(limRaw, 10)
        : 200;
    const events = await loadUserAssignmentHistory(
      u.id,
      Number.isFinite(limit) ? limit : 200,
    );
    res.json({
      user_id: u.id,
      events,
      source_labels: {
        existing_session: "Same rail wallet refreshed (deposit-address)",
        pool_pick: "Picked from merchant pool",
        new_wallet: "New address generated",
      },
    });
  },
);

router.get(
  "/api/v1/admin/users/:userId/payer-deposit-history",
  async (req, res) => {
    const userId =
      typeof req.params.userId === "string" ? req.params.userId.trim() : "";
    if (!userId) {
      res.status(400).json({ error: "user_id_required" });
      return;
    }
    const listEnv = await adminListViewerEnvironment(req);
    const merchantFilter =
      typeof req.query.merchant_id === "string"
        ? req.query.merchant_id.trim()
        : "";
    const uw = userWhereFromRouteParam(userId);
    if (!uw) {
      res.status(400).json({ error: "user_id_required" });
      return;
    }
    const u = await prisma.user.findFirst({
      where: { ...uw, environment: listEnv, ...ACTIVE },
      select: { id: true, merchantId: true },
    });
    if (!u) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const mfInt = merchantFilter
      ? await resolveMerchantInternalId(merchantFilter)
      : null;
    if (merchantFilter && mfInt != null && u.merchantId !== mfInt) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const limRaw = req.query.limit;
    const limit =
      typeof limRaw === "string" && limRaw.trim()
        ? parseInt(limRaw, 10)
        : 200;
    const data = await loadUserPayerDepositHistory(
      u.id,
      Number.isFinite(limit) ? limit : 200,
    );
    res.json({ user_id: u.id, ...data });
  },
);

router.get("/api/v1/admin/transactions", async (req, res) => {
  const { skip, take, page, pageSize } = parsePageQuery(req.query);
  const listEnv = await adminListViewerEnvironment(req);
  const merchantId =
    typeof req.query.merchant_id === "string"
      ? req.query.merchant_id.trim()
      : "";
  const chain =
    typeof req.query.chain === "string" ? req.query.chain.trim() : "";
  const status =
    typeof req.query.status === "string" ? req.query.status.trim() : "";
  const token =
    typeof req.query.token_symbol === "string"
      ? req.query.token_symbol.trim()
      : "";
  const qAddr =
    typeof req.query.address === "string" ? req.query.address.trim() : "";
  const qExtUser =
    typeof req.query.external_user_id === "string"
      ? req.query.external_user_id.trim()
      : "";
  const qTxRef =
    typeof req.query.transaction_id === "string"
      ? req.query.transaction_id.trim()
      : "";

  const txListMerch = merchantId
    ? merchantWhereFromRouteParam(merchantId)
    : null;
  const walletIs = {
    environment: listEnv,
    ...ACTIVE,
    ...(merchantId
      ? txListMerch
        ? { merchant: txListMerch }
        : { id: { in: [] } }
      : {}),
    ...(qAddr
      ? qAddr.startsWith("0x")
        ? { address: { equals: qAddr, mode: "insensitive" } }
        : { address: qAddr }
      : {}),
  };

  const where = {
    ...ACTIVE,
    wallet: { is: walletIs },
    ...(qExtUser
      ? {
          OR: [
            {
              payerUser: {
                is: {
                  ...ACTIVE,
                  externalUserId: { contains: qExtUser, mode: "insensitive" },
                  ...(merchantId
                    ? txListMerch
                      ? { merchant: txListMerch }
                      : { id: { in: [] } }
                    : {}),
                },
              },
            },
            {
              wallet: {
                is: {
                  ...walletIs,
                  assignedUser: {
                    is: {
                      externalUserId: {
                        contains: qExtUser,
                        mode: "insensitive",
                      },
                    },
                  },
                },
              },
            },
          ],
        }
      : {}),
    ...(chain && CHAINS.has(chain) ? { chain } : {}),
    ...(status && Object.values(TxStatus).includes(status) ? { status } : {}),
    ...(token ? { tokenSymbol: { equals: token, mode: "insensitive" } } : {}),
    ...(qTxRef
      ? {
          referenceTransactionId: {
            contains: qTxRef,
            mode: Prisma.QueryMode.insensitive,
          },
        }
      : {}),
  };

  const rawListArgs = {
    listEnv,
    merchantId,
    txListMerch,
    chain,
    chainOk: !!(chain && CHAINS.has(chain)),
    status,
    token,
    qAddr,
    qExtUser,
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
              payerUser: {
                include: {
                  merchant: {
                    select: { id: true, email: true, displayName: true },
                  },
                },
              },
              wallet: {
                include: {
                  merchant: {
                    select: { id: true, email: true, displayName: true },
                  },
                  assignedUser: { select: { id: true, externalUserId: true } },
                },
              },
            },
          }),
        ]
      : [
          countAdminTransactionsListRaw(prisma, rawListArgs),
          listAdminTransactionsListRaw(prisma, {
            ...rawListArgs,
            skip,
            take,
          }),
        ],
  );

  const expectedByKey =
    await loadExpectedAtomicByWalletSessionForTransactions(rows);

  res.json({
    page,
    pageSize,
    total,
    viewer_environment: listEnv,
    transactions: rows.map((t) => {
      const endUser = t.payerUser ?? t.wallet.assignedUser;
      const merch = t.wallet.merchant;
      return {
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
        end_user_id: endUser?.id ?? null,
        external_user_id: endUser?.externalUserId ?? null,
        gateway_environment: t.wallet.environment,
        merchant: merch,
        merchant_id: merch.id,
        merchant_email: merch.email,
        created_at: t.createdAt,
        updated_at: t.updatedAt,
      };
    }),
  });
});

router.post(
  "/api/v1/admin/transactions/:transactionId/redeliver-callback",
  async (req, res) => {
    const transactionId =
      typeof req.params.transactionId === "string"
        ? req.params.transactionId.trim()
        : "";
    if (!transactionId) {
      res.status(400).json({ error: "transaction_id_required" });
      return;
    }

    const result = await redeliverPaymentSuccessWebhookAdmin(transactionId, {
      actorAdminId: req.auth?.sub ?? null,
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

router.post(
  "/api/v1/admin/transactions/:transactionId/rescan-tron-deposit",
  async (req, res) => {
    const transactionId =
      typeof req.params.transactionId === "string"
        ? req.params.transactionId.trim()
        : "";
    if (!transactionId) {
      res.status(400).json({ error: "transaction_id_required" });
      return;
    }
    const result = await adminRescanTronDepositForTransaction(transactionId);
    if (result.ok) {
      res.status(200).json({
        ok: true,
        wallet_id: result.wallet_id,
        transaction: result.transaction,
      });
      return;
    }
    if (result.code === "transaction_not_found") {
      res.status(404).json({ error: result.code });
      return;
    }
    if (result.code === "tronscan_not_configured") {
      res.status(503).json({
        error: result.code,
        ...(result.message ? { message: result.message } : {}),
      });
      return;
    }
    res.status(400).json({
      error: result.code,
      ...(result.message ? { message: result.message } : {}),
    });
  },
);

router.get("/api/v1/admin/wallets", async (req, res) => {
  const { skip, take, page, pageSize } = parsePageQuery(req.query);
  const merchantId =
    typeof req.query.merchant_id === "string"
      ? req.query.merchant_id.trim()
      : "";
  const chain =
    typeof req.query.chain === "string" ? req.query.chain.trim() : "";
  const addressQ =
    typeof req.query.address === "string" ? req.query.address.trim() : "";
  const currency =
    typeof req.query.currency === "string" ? req.query.currency.trim() : "";
  const network =
    typeof req.query.network === "string" ? req.query.network.trim() : "";
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const environmentQ =
    typeof req.query.environment === "string"
      ? req.query.environment.trim().toLowerCase()
      : "";
  const from =
    typeof req.query.created_from === "string"
      ? new Date(req.query.created_from)
      : null;
  const to =
    typeof req.query.created_to === "string"
      ? new Date(req.query.created_to)
      : null;

  /** @type {Record<string, unknown>} */
  const createdAtCond = {};
  if (from && !Number.isNaN(from.getTime())) createdAtCond.gte = from;
  if (to && !Number.isNaN(to.getTime())) {
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);
    createdAtCond.lte = end;
  }
  const hasCreatedAt =
    Object.prototype.hasOwnProperty.call(createdAtCond, "gte") ||
    Object.prototype.hasOwnProperty.call(createdAtCond, "lte");

  const walletMerchantClause = merchantId
    ? merchantWhereFromRouteParam(merchantId)
    : null;
  const where = {
    ...ACTIVE,
    ...(merchantId
      ? walletMerchantClause
        ? { merchant: walletMerchantClause }
        : { id: { in: [] } }
      : {}),
    ...(q
      ? {
          OR: [
            ...(/^\d+$/.test(q) ? [{ id: parseInt(q, 10) }] : []),
            { address: { contains: q, mode: "insensitive" } },
            {
              assignedUser: {
                is: {
                  ...ACTIVE,
                  OR: [
                    {
                      externalUserId: { contains: q, mode: "insensitive" },
                    },
                    ...(/^\d+$/.test(q)
                      ? [{ id: parseInt(q, 10) }]
                      : []),
                  ],
                },
              },
            },
          ],
        }
      : {}),
    ...(chain && CHAINS.has(chain) ? { chain } : {}),
    ...(addressQ
      ? {
          address: addressQ.startsWith("0x")
            ? { equals: addressQ, mode: "insensitive" }
            : { contains: addressQ, mode: "insensitive" },
        }
      : {}),
    ...(currency
      ? { currency: { equals: currency, mode: "insensitive" } }
      : {}),
    ...(network
      ? { network: { equals: network, mode: "insensitive" } }
      : {}),
    ...(hasCreatedAt ? { createdAt: createdAtCond } : {}),
    ...(environmentQ === "live" || environmentQ === "sandbox"
      ? {
          environment:
            environmentQ === "live"
              ? MerchantGatewayEnv.live
              : MerchantGatewayEnv.sandbox,
        }
      : {}),
  };

  const uniqueAddressRaw = req.query.unique_address;
  const uniqueAddress =
    uniqueAddressRaw === "1" ||
    String(uniqueAddressRaw ?? "").toLowerCase() === "true";

  const now = new Date();
  const ttlMin = walletScanTtlMinutes();

  const walletInclude = {
    _count: { select: { transactions: true } },
    merchant: { select: { id: true, email: true, displayName: true } },
    assignedUser: { select: { id: true, externalUserId: true } },
  };

  let total;
  /** @type {any[]} */
  let rows;
  /** @type {Map<number, number> | null} */
  let rowCountById = null;

  if (uniqueAddress) {
    const paged = await listWalletsUniqueByOnChainIdentity(where, skip, take);
    total = paged.total;
    rowCountById = paged.rowCountById;
    if (paged.representativeIds.length === 0) {
      rows = [];
    } else {
      const found = await prisma.wallet.findMany({
        where: { id: { in: paged.representativeIds } },
        include: walletInclude,
      });
      const byId = new Map(found.map((w) => [w.id, w]));
      rows = paged.representativeIds
        .map((id) => byId.get(id))
        .filter((w) => w != null);
    }
  } else {
    const [t, r] = await Promise.all([
      prisma.wallet.count({ where }),
      prisma.wallet.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        include: walletInclude,
      }),
    ]);
    total = t;
    rows = r;
  }

  const statsByWallet = await aggregateWalletTxStats(rows.map((w) => w.id));

  res.json({
    page,
    pageSize,
    total,
    unique_address: uniqueAddress,
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
        derivation_index: w.derivationIndex,
        end_user_id: w.assignedUser?.id ?? null,
        external_user_id: w.assignedUser?.externalUserId ?? null,
        merchant: w.merchant,
        gateway_environment: w.environment,
        created_at: w.createdAt,
        scan_expires_at: exp?.toISOString() ?? null,
        transaction_count: txCount,
        distinct_payer_users: st?.distinct_payers ?? 0,
        success_deposit_count: st?.success_tx ?? 0,
        success_received_display: st?.success_received_display ?? null,
        deposit_scan_active,
        cached_balance_display: w.cachedBalanceDisplay ?? null,
        cached_balance_atomic: w.cachedBalanceAtomic ?? null,
        cached_balance_error: w.cachedBalanceError ?? null,
        cached_balance_updated_at: w.cachedBalanceUpdatedAt?.toISOString() ?? null,
        gateway_wallet_row_count:
          rowCountById?.get(w.id) ?? 1,
      };
    }),
  });
});

router.get("/api/v1/admin/wallets/:walletId/deposit-activity", async (req, res) => {
  const walletId =
    typeof req.params.walletId === "string" ? req.params.walletId.trim() : "";
  if (!walletId) {
    res.status(400).json({ error: "wallet_id_required" });
    return;
  }
  const limRaw = req.query.limit;
  const limit =
    typeof limRaw === "string" && limRaw.trim()
      ? parseInt(limRaw, 10)
      : 100;
  const w = await findWalletByAdminRouteId(walletId);
  if (!w) {
    res.status(404).json({ error: "wallet_not_found" });
    return;
  }
  const data = await loadWalletDepositActivity(
    w.id,
    Number.isFinite(limit) ? limit : 100,
  );
  res.json({
    wallet_id: w.id,
    note: "Rows are on-chain deposits we recorded. API address assignments without a deposit are not listed.",
    ...data,
  });
});

router.post("/api/v1/admin/wallets/refresh-balances", async (_req, res) => {
  try {
    const result = await refreshAllWalletCachedBalances();
    logger.info("admin_wallet_balances_refreshed", {
      total: result.total,
      ok: result.ok,
      failed: result.failed,
    });
    res.json(result);
  } catch (e) {
    logger.error("admin_wallet_balances_refresh_failed", { err: String(e) });
    res.status(500).json({
      error: "refresh_failed",
      message: String(e),
    });
  }
});

router.post(
  "/api/v1/admin/wallets/:walletId/reactivate-deposit-scan",
  async (req, res) => {
    const walletId =
      typeof req.params.walletId === "string"
        ? req.params.walletId.trim()
        : "";
    if (!walletId) {
      res.status(400).json({ error: "wallet_id_required" });
      return;
    }
    try {
      const row = await reactivateWalletDepositScan(walletId, {
        asAdmin: true,
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
      throw e;
    }
  },
);

router.get("/api/v1/admin/withdrawals", async (req, res) => {
  const { skip, take, page, pageSize } = parsePageQuery(req.query);
  const merchantId =
    typeof req.query.merchant_id === "string"
      ? req.query.merchant_id.trim()
      : "";
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

  const wdMerch = merchantId
    ? merchantWhereFromRouteParam(merchantId)
    : null;
  const where = {
    ...ACTIVE,
    ...(merchantId
      ? wdMerch
        ? { merchant: wdMerch }
        : { id: { in: [] } }
      : {}),
    ...(chain && CHAINS.has(chain) ? { chain } : {}),
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
      include: {
        merchant: { select: { id: true, email: true, displayName: true } },
      },
    }),
  ]);

  res.json({
    page,
    pageSize,
    total,
    withdrawals: rows.map((w) => ({
      id: w.id,
      merchant_id: w.merchantId,
      merchant: w.merchant,
      chain: w.chain,
      token_symbol: w.tokenSymbol,
      to_address: w.toAddress,
      amount: w.amount,
      status: w.status,
      tx_hash: w.txHash,
      failure_reason: w.failureReason,
      created_at: w.createdAt,
      updated_at: w.updatedAt,
    })),
  });
});

router.get("/api/v1/admin/tron-sweep/targets", async (req, res) => {
  try {
    const data = await listTronUsdtSweepTargets();
    res.json(data);
  } catch (e) {
    logger.error("admin tron-sweep targets failed", { err: String(e) });
    res.status(500).json({ error: "server_error", message: String(e) });
  }
});

router.post("/api/v1/admin/tron-sweep/one", async (req, res) => {
  const walletId =
    typeof req.body?.wallet_id === "string" ? req.body.wallet_id.trim() : "";
  if (!walletId) {
    return res.status(400).json({
      error: "validation",
      message: "wallet_id is required",
    });
  }
  try {
    const result = await sweepTronUsdtOne(walletId);
    if (!result.ok && result.error === "WALLET_NOT_FOUND") {
      return res.status(404).json({
        ...result,
        message: result.detail ?? result.error ?? "Wallet not found",
      });
    }
    if (!result.ok) {
      return res.status(400).json({
        ...result,
        message: result.detail ?? result.error ?? "Sweep failed",
      });
    }
    res.json(result);
  } catch (e) {
    logger.error("admin tron-sweep one failed", { walletId, err: String(e) });
    res.status(500).json({ error: "server_error", message: String(e) });
  }
});

router.post("/api/v1/admin/tron-sweep/all", async (req, res) => {
  try {
    const data = await sweepTronUsdtAll();
    if (data.configured === false) {
      return res.status(400).json({
        error: "SWEEP_MASTER_TRON_NOT_SET",
        message: "Set SWEEP_MASTER_TRON in server environment to your main TRC20 receive address.",
      });
    }
    res.json(data);
  } catch (e) {
    logger.error("admin tron-sweep all failed", { err: String(e) });
    res.status(500).json({ error: "server_error", message: String(e) });
  }
});

/**
 * @param {unknown} raw
 * @returns {import("@prisma/client").Chain | null}
 */
function parseEvmUsdtSweepChainParam(raw) {
  const c = String(raw ?? "")
    .trim()
    .toUpperCase();
  if (!c || c === "ETH") return Chain.ETH;
  return null;
}

router.get("/api/v1/admin/evm-usdt-sweep/targets", async (req, res) => {
  const chain = parseEvmUsdtSweepChainParam(req.query?.chain);
  if (!chain) {
    return res.status(400).json({
      error: "validation",
      message: "Query chain must be ETH (or omit for ETH)",
    });
  }
  try {
    const data = await listEvmUsdtSweepTargets(chain);
    res.json(data);
  } catch (e) {
    logger.error("admin evm-usdt-sweep targets failed", { err: String(e) });
    res.status(500).json({ error: "server_error", message: String(e) });
  }
});

router.post("/api/v1/admin/evm-usdt-sweep/one", async (req, res) => {
  const walletId =
    typeof req.body?.wallet_id === "string" ? req.body.wallet_id.trim() : "";
  const chain = parseEvmUsdtSweepChainParam(req.body?.chain);
  if (!walletId) {
    return res.status(400).json({
      error: "validation",
      message: "wallet_id is required",
    });
  }
  if (!chain) {
    return res.status(400).json({
      error: "validation",
      message: "body.chain must be ETH (or omit for ETH)",
    });
  }
  try {
    const result = await sweepEvmUsdtOne(walletId, chain);
    if (!result.ok && result.error === "WALLET_NOT_FOUND") {
      return res.status(404).json({
        ...result,
        message: result.detail ?? result.error ?? "Wallet not found",
      });
    }
    if (!result.ok) {
      return res.status(400).json({
        ...result,
        message: result.detail ?? result.error ?? "Sweep failed",
      });
    }
    res.json(result);
  } catch (e) {
    logger.error("admin evm-usdt-sweep one failed", { walletId, chain, err: String(e) });
    res.status(500).json({ error: "server_error", message: String(e) });
  }
});

router.post("/api/v1/admin/evm-usdt-sweep/all", async (req, res) => {
  const chain = parseEvmUsdtSweepChainParam(req.body?.chain);
  if (!chain) {
    return res.status(400).json({
      error: "validation",
      message: "body.chain must be ETH (or omit for ETH)",
    });
  }
  try {
    const data = await sweepEvmUsdtAll(chain);
    if (data.configured === false) {
      return res.status(400).json({
        error: "SWEEP_MASTER_USDT_ETH_NOT_SET",
        message:
          "Set SWEEP_MASTER_USDT_ETH in server environment to your main USDT ERC20 receive address.",
      });
    }
    res.json(data);
  } catch (e) {
    logger.error("admin evm-usdt-sweep all failed", { err: String(e) });
    res.status(500).json({ error: "server_error", message: String(e) });
  }
});

router.get("/api/v1/admin/sweep/targets", async (req, res) => {
  try {
    const data = await listUnifiedSweepTargets();
    res.json(data);
  } catch (e) {
    logger.error("admin unified sweep targets failed", { err: String(e) });
    res.status(500).json({ error: "server_error", message: String(e) });
  }
});

router.post("/api/v1/admin/sweep/one", async (req, res) => {
  const raw =
    req.body?.wallet_id ??
    req.body?.walletId ??
    req.query?.wallet_id ??
    req.query?.walletId;
  let walletId = "";
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0) {
    walletId = String(raw);
  } else if (typeof raw === "string") {
    walletId = raw.trim();
  }
  if (!walletId) {
    return res.status(400).json({
      error: "validation",
      message:
        "wallet_id is required: POST with JSON body { \"wallet_id\": 123 } and header Content-Type: application/json (or form field wallet_id, or query ?wallet_id=123). GET in the browser has no body.",
    });
  }
  try {
    const result = await sweepUnifiedOne(walletId);
    if (!result.ok && result.error === "WALLET_NOT_FOUND") {
      return res.status(404).json({
        ...result,
        message: result.detail ?? result.error ?? "Wallet not found",
      });
    }
    if (!result.ok && result.error === "NOT_SWEEPABLE") {
      return res.status(400).json({
        ...result,
        message: "This wallet rail is not supported for consolidate sweep.",
      });
    }
    if (!result.ok && result.error === "SWEEP_NOT_CONFIGURED") {
      return res.status(400).json({
        ...result,
        message: `Set ${result.master_env ?? "the sweep master"} in server environment for this rail.`,
      });
    }
    if (!result.ok) {
      return res.status(400).json({
        ...result,
        message: result.detail ?? result.error ?? "Sweep failed",
      });
    }
    res.json(result);
  } catch (e) {
    logger.error("admin unified sweep one failed", { walletId, err: String(e) });
    res.status(500).json({ error: "server_error", message: String(e) });
  }
});

router.post("/api/v1/admin/sweep/all", async (req, res) => {
  try {
    const data = await sweepUnifiedAll();
    res.json(data);
  } catch (e) {
    logger.error("admin unified sweep all failed", { err: String(e) });
    res.status(500).json({ error: "server_error", message: String(e) });
  }
});

/**
 * Hidden admin tool (not linked in nav): send **full USDT balance** from a known gateway deposit wallet to any recipient on the same rail.
 * `from_address` must match a `Wallet` row (USDT·TRC20 or USDT·ERC20). On-chain USDT `transfer` only — not a DEX swap.
 */
router.post("/api/v1/admin/tool/send-usdt", async (req, res) => {
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
    const result = await adminDirectionalUsdtSend({ from_address, to_address });
    if (!result.ok) {
      const err = String(result.error ?? "");
      const status =
        err === "FROM_WALLET_NOT_FOUND" || err === "ambiguous_from" ? 404 : 400;
      return res.status(status).json(result);
    }
    res.json(result);
  } catch (e) {
    logger.error("admin tool send-usdt failed", { err: String(e) });
    res.status(500).json({ error: "server_error", message: String(e) });
  }
});

/**
 * @param {unknown} emailRaw
 */
async function resolveMerchantByEmailForSettlements(emailRaw) {
  const email = typeof emailRaw === "string" ? emailRaw.trim() : "";
  if (!email) {
    return {
      ok: false,
      status: 400,
      json: {
        error: "merchant_email_required",
        message: "Enter the merchant login email to load settlements.",
      },
    };
  }
  const merchant = await prisma.merchant.findFirst({
    where: {
      email: { equals: email, mode: "insensitive" },
      deletedAt: null,
    },
    select: {
      id: true,
      email: true,
      displayName: true,
      mdrPercent: true,
      settlementRatePercent: true,
      minSettlementAmount: true,
      settlementPeriodDays: true,
    },
  });
  if (!merchant) {
    return {
      ok: false,
      status: 404,
      json: {
        error: "merchant_not_found",
        message: "No active merchant with that email.",
      },
    };
  }
  return { ok: true, merchant };
}

router.get("/api/v1/admin/settlements", async (req, res) => {
  const { skip, take, page, pageSize } = parsePageQuery(req.query);
  const resolved = await resolveMerchantByEmailForSettlements(req.query.merchant_email);
  if (!resolved.ok) {
    res.status(resolved.status).json(resolved.json);
    return;
  }
  const merchantId = resolved.merchant.id;
  /** Admin settlements are live gateway only (no sandbox payouts). */
  const environment = MerchantGatewayEnv.live;
  const where = { merchantId, environment, ...ACTIVE };
  const [total, rows] = await Promise.all([
    prisma.merchantSettlement.count({ where }),
    prisma.merchantSettlement.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        merchant: { select: { email: true, displayName: true } },
      },
    }),
  ]);
  res.json({
    total,
    page,
    pageSize,
    settlements: rows.map((s) => ({
      id: s.id,
      merchant_id: s.merchantId,
      merchant_email: s.merchant.email,
      merchant_display_name: s.merchant.displayName,
      environment: s.environment,
      chain: s.chain,
      token_symbol: s.tokenSymbol,
      token_decimals: s.tokenDecimals,
      gross_amount: s.grossAmount,
      mdr_percent: Number(s.mdrPercent),
      settlement_rate_percent: Number(s.settlementRatePercent),
      mdr_amount: s.mdrAmount,
      settlement_fee_amount: s.settlementFeeAmount,
      net_amount: s.netAmount,
      transaction_count: s.transactionCount,
      has_proof: Boolean(s.proofFileName),
      created_by_admin_id: s.createdByAdminId,
      created_at: s.createdAt,
    })),
  });
});

router.get("/api/v1/admin/settlements/pending-preview", async (req, res) => {
  const resolved = await resolveMerchantByEmailForSettlements(req.query.merchant_email);
  if (!resolved.ok) {
    res.status(resolved.status).json(resolved.json);
    return;
  }
  const { merchant } = resolved;
  const merchantId = merchant.id;
  const environment = MerchantGatewayEnv.live;

  const buckets = await buildAllPendingPreviews(merchantId, environment, merchant);
  res.json({
    merchant_id: merchantId,
    merchant_email: merchant.email,
    merchant_display_name: merchant.displayName,
    environment,
    fee_rates: {
      mdr_percent: Number(merchant.mdrPercent),
      settlement_rate_percent: Number(merchant.settlementRatePercent),
      min_settlement_amount: merchant.minSettlementAmount,
      settlement_period_days: Number(merchant.settlementPeriodDays ?? 0),
    },
    buckets,
  });
});

router.post(
  "/api/v1/admin/settlements/batch",
  (req, res, next) => {
    settlementProofUpload.single("proof")(req, res, (err) => {
      if (err) {
        logger.warn("settlement upload", { err: String(err) });
        const msg =
          err.message === "invalid_proof_type"
            ? "Proof must be JPEG, PNG, WebP, GIF, or PDF (max 8MB)."
            : "File upload failed.";
        res.status(400).json({ error: "upload_error", message: msg });
        return;
      }
      next();
    });
  },
  async (req, res) => {
    const unlinkUploaded = async () => {
      if (req.file?.path) {
        try {
          await fs.promises.unlink(req.file.path);
        } catch {
          /* ignore */
        }
      }
    };

    const rawMerchantId = req.body?.merchant_id;
    const merchantId =
      typeof rawMerchantId === "number" && Number.isInteger(rawMerchantId)
        ? rawMerchantId
        : typeof rawMerchantId === "string"
          ? rawMerchantId.trim()
          : "";
    if (merchantId === "" || merchantId == null) {
      await unlinkUploaded();
      res.status(400).json({ error: "merchant_id required" });
      return;
    }

    const environment = MerchantGatewayEnv.live;

    const chainRaw = String(req.body.chain ?? "").trim().toUpperCase();
    if (!CHAINS.has(chainRaw)) {
      await unlinkUploaded();
      res.status(400).json({ error: "invalid_chain" });
      return;
    }
    const chain = /** @type {import("@prisma/client").Chain} */ (chainRaw);

    const tokenSymbol =
      typeof req.body.token_symbol === "string" ? req.body.token_symbol.trim() : "";
    if (!tokenSymbol) {
      await unlinkUploaded();
      res.status(400).json({ error: "token_symbol required" });
      return;
    }

    const td = Number(req.body.token_decimals);
    if (!Number.isInteger(td) || td < 0 || td > 36) {
      await unlinkUploaded();
      res.status(400).json({ error: "invalid_token_decimals" });
      return;
    }

    const adminId = req.auth?.sub ?? null;

    if (!req.file?.filename) {
      await unlinkUploaded();
      res.status(400).json({
        error: "proof_required",
        message: "Settlement proof file is required (JPEG, PNG, WebP, GIF, or PDF, max 8MB).",
      });
      return;
    }

    try {
      const row = await executeBatchSettlement({
        merchantId,
        environment,
        chain,
        tokenSymbol,
        tokenDecimals: td,
        proofFileName: req.file.filename,
        adminId,
      });
      res.status(201).json({
        id: row.id,
        merchant_id: row.merchantId,
        environment: row.environment,
        chain: row.chain,
        token_symbol: row.tokenSymbol,
        token_decimals: row.tokenDecimals,
        gross_amount: row.grossAmount,
        mdr_percent: Number(row.mdrPercent),
        settlement_rate_percent: Number(row.settlementRatePercent),
        mdr_amount: row.mdrAmount,
        settlement_fee_amount: row.settlementFeeAmount,
        net_amount: row.netAmount,
        transaction_count: row.transactionCount,
        has_proof: Boolean(row.proofFileName),
        created_at: row.createdAt,
      });
    } catch (e) {
      await unlinkUploaded();
      const code = /** @type {Error & { code?: string }} */ (e).code;
      const msg = String(e?.message ?? e);
      if (code === "merchant_not_found") {
        res.status(404).json({ error: "merchant_not_found" });
        return;
      }
      if (code === "no_eligible_transactions") {
        res.status(400).json({
          error: "no_eligible_transactions",
          message: "No unsettled successful transactions for this asset (check settlement period).",
        });
        return;
      }
      if (code === "below_min_settlement_amount") {
        res.status(400).json({
          error: "below_min_settlement_amount",
          message:
            "Net after fees must be greater than the merchant’s minimum settlement in token units (converted per asset); equal is not enough.",
        });
        return;
      }
      if (code === "proof_required") {
        res.status(400).json({
          error: "proof_required",
          message: "Settlement proof file is required.",
        });
        return;
      }
      if (code === "insufficient_balance") {
        res.status(400).json({
          error: "insufficient_balance",
          message:
            "Net settlement exceeds available portal balance for this chain/token.",
        });
        return;
      }
      if (code === "fee_calculation") {
        res.status(400).json({ error: "fee_calculation", message: msg });
        return;
      }
      logger.error("admin batch settlement", { err: msg });
      res.status(500).json({ error: "internal error" });
    }
  },
);

router.get("/api/v1/admin/settlements/:id/proof", async (req, res) => {
  const id = String(req.params.id ?? "");
  const sw = merchantSettlementWhereFromRouteParam(id);
  if (!sw) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const row = await prisma.merchantSettlement.findFirst({
    where: { ...sw, ...ACTIVE },
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

router.get("/api/v1/admin/supported-chains", (_req, res) => {
  const rec = re.chainEnabledRecord;
  const chains = ADMIN_CHAIN_TOGGLE_ORDER.map((chain) => {
    const meta = CHAIN_ADMIN_META[chain] ?? { label: chain, hint: "" };
    return {
      chain,
      label: meta.label,
      hint: meta.hint,
      active: isChainLiveForPlatform(rec, chain),
    };
  });
  res.json({ chains });
});

router.put("/api/v1/admin/supported-chains", async (req, res) => {
  try {
    const value = serializeChainEnabledFromAdminInput(req.body ?? {});
    await upsertAppSettingKeyValue("CHAIN_ENABLED", value);
    await loadAppSettingsFromDatabase();
    const prune = await pruneMerchantsAfterSupportedChainsChange();
    logger.info("supported-chains update: pruned merchants", prune);
    const rec = re.chainEnabledRecord;
    const chains = ADMIN_CHAIN_TOGGLE_ORDER.map((chain) => {
      const meta = CHAIN_ADMIN_META[chain] ?? { label: chain, hint: "" };
      return {
        chain,
        label: meta.label,
        hint: meta.hint,
        active: isChainLiveForPlatform(rec, chain),
      };
    });
    res.json({ ok: true, chains, merchants_pruned: prune });
  } catch (e) {
    res.status(400).json({ error: "invalid_body", message: String(e) });
  }
});

router.get("/api/v1/admin/system-settings", (_req, res) => {
  res.json({ items: buildAppSettingsAdminList() });
});

router.put("/api/v1/admin/system-settings", async (req, res) => {
  try {
    const body = req.body?.settings ?? req.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return res.status(400).json({
        error: "invalid_body",
        message: "Expected a settings object keyed by env name.",
      });
    }
    await applyAppSettingsPatch(
      /** @type {Record<string, string | null | undefined>} */ (body),
    );
    res.json({ ok: true, items: buildAppSettingsAdminList() });
  } catch (e) {
    logger.error("admin system-settings update failed", { err: String(e) });
    res.status(400).json({
      error: "invalid_settings",
      message: String(e),
    });
  }
});

export { router as adminRouter };
