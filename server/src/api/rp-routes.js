import fs from "fs";
import bcrypt from "bcrypt";
import { Router } from "express";
import { Chain, MerchantGatewayEnv, Prisma, TxStatus } from "@prisma/client";
import { PORTAL_ROLE_MERCHANT, PORTAL_ROLE_RP } from "../constants/portal-role.js";
import { signAuthToken } from "../lib/auth-jwt.js";
import { requireAuth } from "../middleware/require-auth.js";
import { prisma } from "../lib/prisma.js";
import { createMerchantFromPanelBody } from "../services/merchant-account-create.js";
import { ACTIVE } from "../lib/active-row.js";
import { logger } from "../lib/logger.js";
import { parsePageQuery } from "../lib/pagination.js";
import {
  merchantSettlementWhereFromRouteParam,
  merchantWhereFromRouteParam,
  resolveMerchantInternalId,
  transactionWhereFromRouteParam,
  userWhereFromRouteParam,
  walletWhereFromRouteParam,
} from "../lib/entity-internal-id.js";
import {
  proofPathForFileName,
  settlementProofUpload,
} from "../lib/settlement-upload.js";
import { resolveMerchantPortalForLists } from "../lib/merchant-portal-for-lists.js";
import {
  buildAllPendingPreviews,
  executeBatchSettlement,
} from "../services/settlement-batch.js";
import { re } from "../config/runtime-env.js";
import {
  ADMIN_CHAIN_TOGGLE_ORDER,
  CHAIN_ADMIN_META,
  isChainLiveForPlatform,
  listMerchantSelectableChainsForAdmin,
} from "../lib/chain-enable.js";
import { computeRpDashboardPayload } from "../lib/rp-dashboard-query.js";
import {
  batchUserAssignmentStats,
  batchUserPayerTxStats,
  loadUserAssignmentHistory,
  loadUserPayerDepositHistory,
} from "../lib/user-portal-stats.js";
import {
  expectedReceivedAmountQuadForTransaction,
  loadExpectedAtomicByWalletSessionForTransactions,
  requestedAmountFieldsForTransaction,
} from "../lib/transaction-requested-amounts.js";
import { formatAtomicAmountString } from "../lib/format-atomic-amount.js";
import {
  countAdminTransactionsListRaw,
  listAdminTransactionsListRaw,
} from "../lib/admin-transactions-list-raw.js";
import { prismaClientKnowsTxStatusCreated } from "../lib/prisma-tx-status.js";
import { listWalletsUniqueByOnChainIdentity } from "../lib/admin-wallets-unique-address-list.js";
import {
  aggregateWalletTxStats,
  loadWalletDepositActivity,
} from "../lib/wallet-deposit-stats.js";
import { walletScanTtlMinutes } from "../lib/wallet-scan.js";
import { parseDefaultChainsArray } from "../lib/default-chains.js";
import {
  parseSupportedDepositRailsInput,
  pickMerchantDefaultPair,
} from "../lib/merchant-default-pair.js";
import {
  isValidFeePercent,
  parseFeePercent,
  parseSettlementPeriodDays,
  validateAndNormalizeHumanMinSettlement,
} from "../lib/merchant-fee-math.js";
import { generateApiKey, hashApiKey } from "../lib/api-key.js";
import { encryptMerchantApiKey } from "../lib/merchant-api-key-cipher.js";
import { redeliverPaymentSuccessWebhookAdmin } from "../services/callback-service.js";
import { adminRescanTronDepositForTransaction } from "../services/admin-tron-deposit-rescan.js";
import {
  countMerchantLedgerUnion,
  fetchMerchantLedgerUnionPage,
  parseLedgerKindQuery,
} from "../lib/merchant-ledger-merge.js";
import {
  formatAdminRpDepositTransactionJson,
  hydrateAdminRpLedger,
} from "../lib/panel-ledger-hydrate.js";
import { buildPendingPayoutPreviewBuckets } from "../services/merchant-payout-preview.js";

const router = Router();
const rpOnly = requireAuth(PORTAL_ROLE_RP);

/**
 * Scope RP auth to `/api/v1/rp/*` only. A bare `router.use(rpOnly)` runs on every request
 * that reaches this router — including `/api/v1/merchant/*` — so MERCHANT JWTs hit 403
 * `forbidden` before `merchantRouter` runs (same mount order as `admin` → `rp` → `merchant`).
 */
router.use("/api/v1/rp", rpOnly);

const CHAINS = new Set(Object.values(Chain));

/**
 * @param {number} rpId
 * @param {number} merchantId
 */
async function rpOwnsMerchant(rpId, merchantId) {
  const m = await prisma.merchant.findFirst({
    where: { id: merchantId, resellerPartnerId: rpId, ...ACTIVE },
    select: { id: true },
  });
  return Boolean(m);
}

/**
 * @param {number} rpId
 * @param {string} transactionIdParam
 */
async function rpOwnsTransaction(rpId, transactionIdParam) {
  const txw = transactionWhereFromRouteParam(String(transactionIdParam ?? ""));
  if (!txw) return false;
  const hit = await prisma.transaction.findFirst({
    where: {
      ...txw,
      ...ACTIVE,
      wallet: {
        is: {
          ...ACTIVE,
          merchant: { resellerPartnerId: rpId, deletedAt: null },
        },
      },
    },
    select: { id: true },
  });
  return Boolean(hit);
}

/** @param {{ auth?: { sub?: string } }} req */
function rpIdFromReq(req) {
  const rpId = parseInt(String(req.auth?.sub ?? ""), 10);
  return Number.isInteger(rpId) && rpId > 0 ? rpId : null;
}

/**
 * @param {number} rpId
 * @returns {Promise<import("@prisma/client").MerchantGatewayEnv>}
 */
async function rpListViewerEnvironment(rpId) {
  const row = await prisma.resellerPartner.findFirst({
    where: { id: rpId, deletedAt: null },
    select: { portalEnvironment: true },
  });
  return row?.portalEnvironment === MerchantGatewayEnv.sandbox
    ? MerchantGatewayEnv.sandbox
    : MerchantGatewayEnv.live;
}

/**
 * @param {number} rpId
 * @returns {Promise<number[]>}
 */
async function rpMerchantIdArray(rpId) {
  const rows = await prisma.merchant.findMany({
    where: { resellerPartnerId: rpId, deletedAt: null },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

router.get("/api/v1/rp/supported-chains", (_req, res) => {
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

router.get("/api/v1/rp/dashboard", async (req, res) => {
  const rpId = rpIdFromReq(req);
  if (!rpId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const listEnv = await rpListViewerEnvironment(rpId);
  const q =
    req.query && typeof req.query === "object"
      ? /** @type {Record<string, string | undefined>} */ (req.query)
      : {};
  const payload = await computeRpDashboardPayload(prisma, { rpId, listEnv, query: q });
  res.json(payload);
});

router.get("/api/v1/rp/users", async (req, res) => {
  const rpId = rpIdFromReq(req);
  if (!rpId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const mids = await rpMerchantIdArray(rpId);
  const { skip, take, page, pageSize } = parsePageQuery(req.query);
  const listEnv = await rpListViewerEnvironment(rpId);
  if (mids.length === 0) {
    res.json({ page, pageSize, total: 0, viewer_environment: listEnv, users: [] });
    return;
  }
  const merchantId =
    typeof req.query.merchant_id === "string" ? req.query.merchant_id.trim() : "";
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const from =
    typeof req.query.created_from === "string" ? new Date(req.query.created_from) : null;
  const to =
    typeof req.query.created_to === "string" ? new Date(req.query.created_to) : null;

  /** @type {import("@prisma/client").Prisma.IntFilter | number} */
  let merchantIdFilter = { in: mids };
  if (merchantId) {
    const mf = await resolveMerchantInternalId(merchantId);
    if (mf == null || !mids.includes(mf)) {
      res.json({ page, pageSize, total: 0, viewer_environment: listEnv, users: [] });
      return;
    }
    merchantIdFilter = mf;
  }

  const where = {
    environment: listEnv,
    ...ACTIVE,
    merchantId: typeof merchantIdFilter === "number" ? merchantIdFilter : merchantIdFilter,
    ...(q
      ? {
          OR: [
            { externalUserId: { contains: q, mode: "insensitive" } },
            ...(/^\d+$/.test(q) ? [{ id: parseInt(q, 10) }] : []),
          ],
        }
      : {}),
    ...(from && !Number.isNaN(from.getTime()) ? { createdAt: { gte: from } } : {}),
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
        merchant: {
          select: {
            id: true,
            email: true,
            displayName: true,
            resellerPartnerId: true,
            resellerPartner: { select: { id: true, email: true, displayName: true } },
          },
        },
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
      const merch = u.merchant;
      return {
        id: u.id,
        external_user_id: u.externalUserId,
        merchant: {
          id: merch.id,
          email: merch.email,
          display_name: merch.displayName,
          reseller_partner_id: merch.resellerPartnerId ?? null,
          reseller_partner_email: merch.resellerPartner?.email ?? null,
          reseller_partner_display_name: merch.resellerPartner?.displayName ?? null,
        },
        reseller_partner_id: merch.resellerPartnerId ?? null,
        reseller_partner_email: merch.resellerPartner?.email ?? null,
        reseller_partner_display_name: merch.resellerPartner?.displayName ?? null,
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

router.get("/api/v1/rp/users/:userId/wallet-assignment-history", async (req, res) => {
  const rpId = rpIdFromReq(req);
  if (!rpId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const userId = typeof req.params.userId === "string" ? req.params.userId.trim() : "";
  if (!userId) {
    res.status(400).json({ error: "user_id_required" });
    return;
  }
  const listEnv = await rpListViewerEnvironment(rpId);
  const merchantFilter =
    typeof req.query.merchant_id === "string" ? req.query.merchant_id.trim() : "";
  const uw = userWhereFromRouteParam(userId);
  if (!uw) {
    res.status(400).json({ error: "user_id_required" });
    return;
  }
  const u = await prisma.user.findFirst({
    where: { ...uw, environment: listEnv, ...ACTIVE },
    select: { id: true, merchantId: true },
  });
  if (!u || !(await rpOwnsMerchant(rpId, u.merchantId))) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const mfInt = merchantFilter ? await resolveMerchantInternalId(merchantFilter) : null;
  if (merchantFilter && (mfInt == null || mfInt !== u.merchantId)) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const limRaw = req.query.limit;
  const limit = typeof limRaw === "string" && limRaw.trim() ? parseInt(limRaw, 10) : 200;
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
});

router.get("/api/v1/rp/users/:userId/payer-deposit-history", async (req, res) => {
  const rpId = rpIdFromReq(req);
  if (!rpId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const userId = typeof req.params.userId === "string" ? req.params.userId.trim() : "";
  if (!userId) {
    res.status(400).json({ error: "user_id_required" });
    return;
  }
  const listEnv = await rpListViewerEnvironment(rpId);
  const merchantFilter =
    typeof req.query.merchant_id === "string" ? req.query.merchant_id.trim() : "";
  const uw = userWhereFromRouteParam(userId);
  if (!uw) {
    res.status(400).json({ error: "user_id_required" });
    return;
  }
  const u = await prisma.user.findFirst({
    where: { ...uw, environment: listEnv, ...ACTIVE },
    select: { id: true, merchantId: true },
  });
  if (!u || !(await rpOwnsMerchant(rpId, u.merchantId))) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const mfInt = merchantFilter ? await resolveMerchantInternalId(merchantFilter) : null;
  if (merchantFilter && (mfInt == null || mfInt !== u.merchantId)) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const limRaw = req.query.limit;
  const limit = typeof limRaw === "string" && limRaw.trim() ? parseInt(limRaw, 10) : 200;
  const data = await loadUserPayerDepositHistory(
    u.id,
    Number.isFinite(limit) ? limit : 200,
  );
  res.json({ user_id: u.id, ...data });
});

router.get("/api/v1/rp/merchants", async (req, res) => {
  const rpId = rpIdFromReq(req);
  if (!rpId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const { skip, take, page, pageSize } = parsePageQuery(req.query);
  const search =
    typeof req.query.search === "string" ? req.query.search.trim() : "";
  const isActive =
    req.query.is_active === "true"
      ? true
      : req.query.is_active === "false"
        ? false
        : undefined;

  const listScope =
    typeof req.query.list_scope === "string" ? req.query.list_scope.trim() : "";
  const deletedClause =
    listScope === "all"
      ? {}
      : listScope === "deleted"
        ? { deletedAt: { not: null } }
        : { deletedAt: null };

  const where = {
    resellerPartnerId: rpId,
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
        payoutMdrPercent: true,
        settlementRatePercent: true,
        minSettlementAmount: true,
        settlementPeriodDays: true,
        resellerPartnerId: true,
        resellerPartner: { select: { id: true, email: true, displayName: true } },
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
      payout_mdr_percent: Number(m.payoutMdrPercent),
      settlement_rate_percent: Number(m.settlementRatePercent),
      min_settlement_amount: m.minSettlementAmount,
      settlement_period_days: m.settlementPeriodDays,
      end_users_live: liveUserCounts.get(m.id) ?? 0,
      end_users_sandbox: sandboxUserCounts.get(m.id) ?? 0,
      reseller_partner_id: m.resellerPartnerId ?? null,
      reseller_partner_email: m.resellerPartner?.email ?? null,
      reseller_partner_display_name: m.resellerPartner?.displayName ?? null,
    })),
  });
});

router.get("/api/v1/rp/merchants/:id", async (req, res) => {
  const rpId = rpIdFromReq(req);
  if (!rpId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const id = String(req.params.id ?? "");
  const mw = merchantWhereFromRouteParam(id);
  if (!mw) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const row = await prisma.merchant.findFirst({
    where: { ...mw, resellerPartnerId: rpId, ...ACTIVE },
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
      payoutMdrPercent: true,
      settlementRatePercent: true,
      minSettlementAmount: true,
      settlementPeriodDays: true,
      resellerPartnerId: true,
      resellerPartner: { select: { id: true, email: true, displayName: true } },
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
    payout_mdr_percent: Number(row.payoutMdrPercent),
    settlement_rate_percent: Number(row.settlementRatePercent),
    min_settlement_amount: row.minSettlementAmount,
    settlement_period_days: row.settlementPeriodDays,
    end_users_live: endUsersLive,
    end_users_sandbox: endUsersSandbox,
    reseller_partner_id: row.resellerPartnerId ?? null,
    reseller_partner_email: row.resellerPartner?.email ?? null,
    reseller_partner_display_name: row.resellerPartner?.displayName ?? null,
    platform_enabled_chains: listMerchantSelectableChainsForAdmin(re.chainEnabledRecord),
  });
});

router.patch("/api/v1/rp/merchants/:id", async (req, res) => {
  const rpId = rpIdFromReq(req);
  if (!rpId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const id = String(req.params.id ?? "");
  const mw = merchantWhereFromRouteParam(id);
  if (!mw) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const existing = await prisma.merchant.findFirst({
    where: { ...mw, resellerPartnerId: rpId, ...ACTIVE },
  });
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

  const body = req.body ?? {};
  let newApiKey;
  let newSandboxApiKey;
  /** @type {import("@prisma/client").Prisma.MerchantUpdateInput} */
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

  if (body.mdr_percent !== undefined) {
    const p = parseFeePercent(body.mdr_percent);
    if (p === null || !isValidFeePercent(p)) {
      res.status(400).json({
        error: "invalid_fee_percent",
        message: "MDR must be a number from 0 to 100.",
      });
      return;
    }
    data.mdrPercent = p;
  }
  if (body.payout_mdr_percent !== undefined) {
    const p = parseFeePercent(body.payout_mdr_percent);
    if (p === null || !isValidFeePercent(p)) {
      res.status(400).json({
        error: "invalid_payout_mdr_percent",
        message: "Payout MDR must be a number from 0 to 100.",
      });
      return;
    }
    data.payoutMdrPercent = p;
  }
  /** RP-linked merchants: no platform settlement fee (MDR-only settlements). */
  data.settlementRatePercent = 0;

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
      payoutMdrPercent: true,
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
    payout_mdr_percent: Number(row.payoutMdrPercent),
    settlement_rate_percent: Number(row.settlementRatePercent),
    min_settlement_amount: row.minSettlementAmount,
    settlement_period_days: row.settlementPeriodDays,
    api_key: newApiKey,
    sandbox_api_key: newSandboxApiKey,
    message,
  });
});

/** Same as admin impersonate, scoped to merchants linked to this reseller partner. */
router.post("/api/v1/rp/merchants/:id/impersonate", async (req, res) => {
  const rpId = rpIdFromReq(req);
  if (!rpId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const id = String(req.params.id ?? "");
  const mw = merchantWhereFromRouteParam(id);
  if (!mw) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const row = await prisma.merchant.findFirst({
    where: {
      AND: [mw, { resellerPartnerId: rpId, deletedAt: null }],
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

/** Soft-delete (same semantics as admin), scoped to this partner's merchant. */
router.delete("/api/v1/rp/merchants/:id", async (req, res) => {
  const rpId = rpIdFromReq(req);
  if (!rpId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const id = String(req.params.id ?? "");
  const mw = merchantWhereFromRouteParam(id);
  if (!mw) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const hit = await prisma.merchant.findFirst({
    where: { ...mw, resellerPartnerId: rpId },
  });
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

router.post("/api/v1/rp/transactions/:transactionId/redeliver-callback", async (req, res) => {
  const rpId = rpIdFromReq(req);
  if (!rpId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const transactionId =
    typeof req.params.transactionId === "string" ? req.params.transactionId.trim() : "";
  if (!transactionId) {
    res.status(400).json({ error: "transaction_id_required" });
    return;
  }
  if (!(await rpOwnsTransaction(rpId, transactionId))) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const result = await redeliverPaymentSuccessWebhookAdmin(transactionId, {
    actorAdminId: null,
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
});

router.post("/api/v1/rp/transactions/:transactionId/rescan-tron-deposit", async (req, res) => {
  const rpId = rpIdFromReq(req);
  if (!rpId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const transactionId =
    typeof req.params.transactionId === "string" ? req.params.transactionId.trim() : "";
  if (!transactionId) {
    res.status(400).json({ error: "transaction_id_required" });
    return;
  }
  if (!(await rpOwnsTransaction(rpId, transactionId))) {
    res.status(404).json({ error: "not_found" });
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
});

router.get("/api/v1/rp/transactions", async (req, res) => {
  const rpId = rpIdFromReq(req);
  if (!rpId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const mids = await rpMerchantIdArray(rpId);
  const { skip, take, page, pageSize } = parsePageQuery(req.query);
  const listEnv = await rpListViewerEnvironment(rpId);
  if (mids.length === 0) {
    res.json({
      page,
      pageSize,
      total: 0,
      viewer_environment: listEnv,
      transactions: [],
      ledger: [],
    });
    return;
  }
  const merchantId =
    typeof req.query.merchant_id === "string" ? req.query.merchant_id.trim() : "";
  const chain = typeof req.query.chain === "string" ? req.query.chain.trim() : "";
  const status = typeof req.query.status === "string" ? req.query.status.trim() : "";
  const token =
    typeof req.query.token_symbol === "string" ? req.query.token_symbol.trim() : "";
  const qAddr = typeof req.query.address === "string" ? req.query.address.trim() : "";
  const qExtUser =
    typeof req.query.external_user_id === "string"
      ? req.query.external_user_id.trim()
      : "";
  const qTxRef =
    typeof req.query.transaction_id === "string"
      ? req.query.transaction_id.trim()
      : "";

  const ledgerKind = parseLedgerKindQuery(req.query.ledger_kind);

  const txListMerch = merchantId ? merchantWhereFromRouteParam(merchantId) : null;
  if (merchantId && !txListMerch) {
    res.json({ page, pageSize, total: 0, viewer_environment: listEnv, transactions: [] });
    return;
  }
  /** @type {number[]} */
  let rpLedgerMids = mids;
  if (merchantId && txListMerch) {
    const owned = await prisma.merchant.findFirst({
      where: { ...txListMerch, resellerPartnerId: rpId, ...ACTIVE },
      select: { id: true },
    });
    if (!owned) {
      res.json({
        page,
        pageSize,
        total: 0,
        viewer_environment: listEnv,
        transactions: [],
        ledger: [],
      });
      return;
    }
    rpLedgerMids = [owned.id];
  }

  const depositOnly =
    Boolean(qExtUser.trim()) || Boolean(qTxRef.trim()) || Boolean(qAddr.trim());
  const useDepositOnlyPrismaPath = ledgerKind !== "payout" && depositOnly;

  if (!useDepositOnlyPrismaPath && rpLedgerMids.length > 0) {
    const unionParams = {
      merchantIds: rpLedgerMids,
      environment: listEnv,
      skip,
      take,
      chain,
      chainOk: !!(chain && CHAINS.has(chain)),
      token,
      statusUi: status,
      qUser: "",
      qTxRef: "",
      qAddr: "",
      ledgerKind,
    };
    const totalM = await countMerchantLedgerUnion(prisma, unionParams);
    if (totalM !== null) {
      const unionRows = await fetchMerchantLedgerUnionPage(prisma, unionParams);
      const { ledger } = await hydrateAdminRpLedger(
        prisma,
        unionRows,
        rpLedgerMids,
        listEnv,
      );
      const transactions = ledger
        .filter((x) => x.kind === "deposit")
        .map((x) => x.deposit);
      res.json({
        page,
        pageSize,
        total: totalM,
        viewer_environment: listEnv,
        ledger_kind: ledgerKind,
        ledger,
        transactions,
      });
      return;
    }
  }

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
    rpMerchantIds: merchantId ? null : mids,
  };

  const [total, rows] = await Promise.all(
    prismaClientKnowsTxStatusCreated()
      ? [
          prisma.transaction.count({
            where: {
              ...ACTIVE,
              wallet: {
                is: {
                  environment: listEnv,
                  ...ACTIVE,
                  ...(merchantId && txListMerch
                    ? { merchant: txListMerch }
                    : { merchantId: { in: mids } }),
                  ...(qAddr
                    ? qAddr.startsWith("0x")
                      ? { address: { equals: qAddr, mode: "insensitive" } }
                      : { address: qAddr }
                    : {}),
                },
              },
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
              ...(qExtUser
                ? {
                    OR: [
                      {
                        payerUser: {
                          is: {
                            ...ACTIVE,
                            externalUserId: { contains: qExtUser, mode: "insensitive" },
                            ...(merchantId && txListMerch
                              ? { merchant: txListMerch }
                              : { merchantId: { in: mids } }),
                          },
                        },
                      },
                      {
                        wallet: {
                          is: {
                            environment: listEnv,
                            ...ACTIVE,
                            ...(merchantId && txListMerch
                              ? { merchant: txListMerch }
                              : { merchantId: { in: mids } }),
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
            },
          }),
          prisma.transaction.findMany({
            where: {
              ...ACTIVE,
              wallet: {
                is: {
                  environment: listEnv,
                  ...ACTIVE,
                  ...(merchantId && txListMerch
                    ? { merchant: txListMerch }
                    : { merchantId: { in: mids } }),
                  ...(qAddr
                    ? qAddr.startsWith("0x")
                      ? { address: { equals: qAddr, mode: "insensitive" } }
                      : { address: qAddr }
                    : {}),
                },
              },
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
              ...(qExtUser
                ? {
                    OR: [
                      {
                        payerUser: {
                          is: {
                            ...ACTIVE,
                            externalUserId: { contains: qExtUser, mode: "insensitive" },
                            ...(merchantId && txListMerch
                              ? { merchant: txListMerch }
                              : { merchantId: { in: mids } }),
                          },
                        },
                      },
                      {
                        wallet: {
                          is: {
                            environment: listEnv,
                            ...ACTIVE,
                            ...(merchantId && txListMerch
                              ? { merchant: txListMerch }
                              : { merchantId: { in: mids } }),
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
            },
            orderBy: { createdAt: "desc" },
            skip,
            take,
            include: {
              payerUser: {
                include: {
                  merchant: {
                    select: {
                      id: true,
                      email: true,
                      displayName: true,
                      resellerPartnerId: true,
                      resellerPartner: { select: { id: true, email: true, displayName: true } },
                    },
                  },
                },
              },
              wallet: {
                include: {
                  merchant: {
                    select: {
                      id: true,
                      email: true,
                      displayName: true,
                      resellerPartnerId: true,
                      resellerPartner: { select: { id: true, email: true, displayName: true } },
                    },
                  },
                  assignedUser: { select: { id: true, externalUserId: true } },
                },
              },
            },
          }),
        ]
      : [
          countAdminTransactionsListRaw(prisma, rawListArgs),
          listAdminTransactionsListRaw(prisma, { ...rawListArgs, skip, take }),
        ],
  );

  const expectedByKey =
    await loadExpectedAtomicByWalletSessionForTransactions(rows);

  const transactions = rows.map((t) =>
    formatAdminRpDepositTransactionJson(t, expectedByKey),
  );
  const ledger = transactions.map((d) => ({
    kind: "deposit",
    created_at: d.created_at,
    deposit: d,
  }));

  res.json({
    page,
    pageSize,
    total,
    viewer_environment: listEnv,
    ledger_kind: "deposit",
    ledger,
    transactions,
  });
});

router.get("/api/v1/rp/wallets", async (req, res) => {
  const rpId = rpIdFromReq(req);
  if (!rpId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const mids = await rpMerchantIdArray(rpId);
  const { skip, take, page, pageSize } = parsePageQuery(req.query);
  if (mids.length === 0) {
    res.json({
      page,
      pageSize,
      total: 0,
      unique_address: false,
      deposit_scan_ttl_minutes: walletScanTtlMinutes(),
      wallets: [],
    });
    return;
  }
  const merchantId =
    typeof req.query.merchant_id === "string" ? req.query.merchant_id.trim() : "";
  const chain = typeof req.query.chain === "string" ? req.query.chain.trim() : "";
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
    typeof req.query.created_from === "string" ? new Date(req.query.created_from) : null;
  const to =
    typeof req.query.created_to === "string" ? new Date(req.query.created_to) : null;

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

  const walletMerchantClause = merchantId ? merchantWhereFromRouteParam(merchantId) : null;
  if (merchantId && !walletMerchantClause) {
    res.json({
      page,
      pageSize,
      total: 0,
      unique_address: false,
      deposit_scan_ttl_minutes: walletScanTtlMinutes(),
      wallets: [],
    });
    return;
  }
  if (merchantId && walletMerchantClause) {
    const owned = await prisma.merchant.findFirst({
      where: { ...walletMerchantClause, resellerPartnerId: rpId, ...ACTIVE },
      select: { id: true },
    });
    if (!owned) {
      res.json({
        page,
        pageSize,
        total: 0,
        unique_address: false,
        deposit_scan_ttl_minutes: walletScanTtlMinutes(),
        wallets: [],
      });
      return;
    }
  }

  const where = {
    ...ACTIVE,
    ...(merchantId && walletMerchantClause
      ? { merchant: walletMerchantClause }
      : { merchantId: { in: mids } }),
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
                    ...(/^\d+$/.test(q) ? [{ id: parseInt(q, 10) }] : []),
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
    uniqueAddressRaw === "1" || String(uniqueAddressRaw ?? "").toLowerCase() === "true";

  const now = new Date();
  const ttlMin = walletScanTtlMinutes();

  const walletInclude = {
    _count: { select: { transactions: true } },
    merchant: {
      select: {
        id: true,
        email: true,
        displayName: true,
        resellerPartnerId: true,
        resellerPartner: { select: { id: true, email: true, displayName: true } },
      },
    },
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
      const deposit_scan_active = txCount > 0 || exp == null || exp > now;
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
        merchant: {
          id: w.merchant.id,
          email: w.merchant.email,
          display_name: w.merchant.displayName,
          reseller_partner_id: w.merchant.resellerPartnerId ?? null,
          reseller_partner_email: w.merchant.resellerPartner?.email ?? null,
          reseller_partner_display_name: w.merchant.resellerPartner?.displayName ?? null,
        },
        reseller_partner_id: w.merchant.resellerPartnerId ?? null,
        reseller_partner_email: w.merchant.resellerPartner?.email ?? null,
        reseller_partner_display_name: w.merchant.resellerPartner?.displayName ?? null,
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
        gateway_wallet_row_count: rowCountById?.get(w.id) ?? 1,
      };
    }),
  });
});

router.get("/api/v1/rp/wallets/:walletId/deposit-activity", async (req, res) => {
  const rpId = rpIdFromReq(req);
  if (!rpId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const walletId =
    typeof req.params.walletId === "string" ? req.params.walletId.trim() : "";
  if (!walletId) {
    res.status(400).json({ error: "wallet_id_required" });
    return;
  }
  const ww = walletWhereFromRouteParam(walletId);
  if (!ww) {
    res.status(404).json({ error: "wallet_not_found" });
    return;
  }
  const w = await prisma.wallet.findFirst({
    where: { ...ww, ...ACTIVE, merchant: { resellerPartnerId: rpId, deletedAt: null } },
    select: { id: true },
  });
  if (!w) {
    res.status(404).json({ error: "wallet_not_found" });
    return;
  }
  const limRaw = req.query.limit;
  const limit =
    typeof limRaw === "string" && limRaw.trim() ? parseInt(limRaw, 10) : 100;
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

router.post("/api/v1/rp/merchants", async (req, res) => {
  const rpId = parseInt(String(req.auth?.sub ?? ""), 10);
  if (!Number.isInteger(rpId) || rpId < 1) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  try {
    const result = await createMerchantFromPanelBody(req.body ?? {}, {
      resellerPartnerId: rpId,
    });
    if (!result.ok) {
      res.status(result.status).json(result.json);
      return;
    }
    const { row, apiSecret, password } = result;
    const body = req.body ?? {};
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
      payout_mdr_percent: Number(row.payoutMdrPercent),
      settlement_rate_percent: Number(row.settlementRatePercent),
      min_settlement_amount: row.minSettlementAmount,
      settlement_period_days: row.settlementPeriodDays,
      temporary_password: body.password?.trim() ? undefined : password,
      api_key: apiSecret,
      sandbox_api_key: apiSecret,
      message:
        "Share the gateway secret with the merchant once. Deposit addresses are derived from the BIP39 phrase you provided (stored encrypted).",
    });
  } catch (e) {
    logger.error("rp create merchant", { err: String(e) });
    res.status(500).json({ error: "internal error" });
  }
});

router.get("/api/v1/rp/settlements/pending-preview", async (req, res) => {
  const rpId = parseInt(String(req.auth?.sub ?? ""), 10);
  if (!Number.isInteger(rpId) || rpId < 1) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const midRaw = req.query.merchant_id ?? req.query.merchantId;
  const mid =
    typeof midRaw === "string"
      ? parseInt(midRaw.trim(), 10)
      : typeof midRaw === "number"
        ? midRaw
        : NaN;
  if (!Number.isInteger(mid) || mid < 1) {
    res.status(400).json({
      error: "merchant_id_required",
      message: "Pass merchant_id for one of your merchants (same as merchant portal).",
    });
    return;
  }
  if (!(await rpOwnsMerchant(rpId, mid))) {
    res.status(403).json({ error: "forbidden" });
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
      email: true,
      displayName: true,
      resellerPartner: { select: { email: true, displayName: true } },
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
    merchant_id: mid,
    merchant_email: merchRates.email,
    merchant_display_name: merchRates.displayName,
    reseller_partner_email: merchRates.resellerPartner?.email ?? null,
    reseller_partner_display_name: merchRates.resellerPartner?.displayName ?? null,
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

router.get("/api/v1/rp/settlements/payout-preview", async (req, res) => {
  const rpId = parseInt(String(req.auth?.sub ?? ""), 10);
  if (!Number.isInteger(rpId) || rpId < 1) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const midRaw = req.query.merchant_id ?? req.query.merchantId;
  const mid =
    typeof midRaw === "string"
      ? parseInt(midRaw.trim(), 10)
      : typeof midRaw === "number"
        ? midRaw
        : NaN;
  if (!Number.isInteger(mid) || mid < 1) {
    res.status(400).json({
      error: "merchant_id_required",
      message: "Pass merchant_id for one of your merchants.",
    });
    return;
  }
  if (!(await rpOwnsMerchant(rpId, mid))) {
    res.status(403).json({ error: "forbidden" });
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
      payoutMdrPercent: true,
      email: true,
      displayName: true,
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
    merchant_id: mid,
    merchant_email: merchRates.email,
    merchant_display_name: merchRates.displayName,
    fee_rates: {
      payout_mdr_percent: Number(merchRates.payoutMdrPercent),
    },
    buckets,
  });
});

router.get("/api/v1/rp/settlements", async (req, res) => {
  const rpId = parseInt(String(req.auth?.sub ?? ""), 10);
  if (!Number.isInteger(rpId) || rpId < 1) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const midRaw = req.query.merchant_id ?? req.query.merchantId;
  const mid =
    typeof midRaw === "string"
      ? parseInt(midRaw.trim(), 10)
      : typeof midRaw === "number"
        ? midRaw
        : NaN;
  if (!Number.isInteger(mid) || mid < 1) {
    res.status(400).json({
      error: "merchant_id_required",
      message: "Choose a merchant to list settlements (same views as the merchant portal).",
    });
    return;
  }
  if (!(await rpOwnsMerchant(rpId, mid))) {
    res.status(403).json({ error: "forbidden" });
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
    merchant_id: mid,
    environment,
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

router.post(
  "/api/v1/rp/settlements/batch",
  (req, res, next) => {
    settlementProofUpload.single("proof")(req, res, (err) => {
      if (err) {
        logger.warn("rp settlement upload", { err: String(err) });
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

    const rpId = rpIdFromReq(req);
    if (!rpId) {
      await unlinkUploaded();
      res.status(401).json({ error: "unauthorized" });
      return;
    }

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
    if (!(await rpOwnsMerchant(rpId, Number(merchantId)))) {
      await unlinkUploaded();
      res.status(403).json({ error: "forbidden" });
      return;
    }

    const gate = await resolveMerchantPortalForLists(Number(merchantId));
    if (!gate.ok) {
      await unlinkUploaded();
      res.status(gate.status).json({
        error: gate.error,
        ...(gate.message ? { message: gate.message } : {}),
      });
      return;
    }
    const { environment } = gate;

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
        merchantId: Number(merchantId),
        environment,
        chain,
        tokenSymbol,
        tokenDecimals: td,
        proofFileName: req.file.filename,
        adminId: null,
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
      logger.error("rp batch settlement", { err: msg });
      res.status(500).json({ error: "internal error" });
    }
  },
);

router.get("/api/v1/rp/settlements/:id/proof", async (req, res) => {
  const rpId = parseInt(String(req.auth?.sub ?? ""), 10);
  if (!Number.isInteger(rpId) || rpId < 1) {
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
    where: { ...sw, ...ACTIVE },
    select: { proofFileName: true, merchantId: true },
  });
  if (!row?.proofFileName) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (!(await rpOwnsMerchant(rpId, row.merchantId))) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const full = proofPathForFileName(row.proofFileName);
  if (!full || !fs.existsSync(full)) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.sendFile(full);
});

export { router as rpRouter };
