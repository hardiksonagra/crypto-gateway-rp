import { Router } from "express";
import bcrypt from "bcrypt";
import {
  AdminRole,
  Chain,
  MerchantGatewayEnv,
  Prisma,
  TxStatus,
  WithdrawalStatus,
} from "@prisma/client";
import { formatAtomicAmountString } from "../lib/format-atomic-amount.js";
import {
  reactivateWalletDepositScan,
  walletScanTtlMinutes,
} from "../lib/wallet-scan.js";
import { prisma } from "../lib/prisma.js";
import { signAuthToken } from "../lib/auth-jwt.js";
import { requireAuth } from "../middleware/require-auth.js";
import { logPanelMutations } from "../middleware/log-panel-mutations.js";
import { parsePageQuery } from "../lib/pagination.js";
import { generateApiKey, hashApiKey } from "../lib/api-key.js";
import { encryptMerchantApiKey } from "../lib/merchant-api-key-cipher.js";
import { logger } from "../lib/logger.js";
import { env } from "../config/env.js";
import { parseDefaultChainsArray } from "../lib/default-chains.js";
import { depositRailKey } from "../config/payment-rails.js";
import {
  parseSupportedDepositRailsInput,
  pickMerchantDefaultPair,
} from "../lib/merchant-default-pair.js";
import { redeliverPaymentSuccessWebhookAdmin } from "../services/callback-service.js";
import {
  listTronUsdtSweepTargets,
  sweepTronUsdtAll,
  sweepTronUsdtOne,
} from "../services/sweep/tron-usdt-sweep.js";
import {
  listSolanaUsdtSweepTargets,
  sweepSolanaUsdtAll,
  sweepSolanaUsdtOne,
} from "../services/sweep/solana-usdt-sweep.js";
import {
  listTronTrxSweepTargets,
  sweepTronTrxAll,
  sweepTronTrxOne,
} from "../services/sweep/tron-trx-sweep.js";
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
import crypto from "crypto";

const router = Router();
const adminOnly = requireAuth(AdminRole.ADMIN);

const CHAINS = new Set(Object.values(Chain));

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
  const row = await prisma.adminUser.findUnique({
    where: { id },
    select: { portalEnvironment: true, role: true },
  });
  if (!row || row.role !== AdminRole.ADMIN) return MerchantGatewayEnv.live;
  return row.portalEnvironment === MerchantGatewayEnv.sandbox
    ? MerchantGatewayEnv.sandbox
    : MerchantGatewayEnv.live;
}

router.get("/api/v1/admin/dashboard", async (req, res) => {
  const listEnv = await adminListViewerEnvironment(req);
  const txEnvWhere = {
    wallet: { is: { user: { environment: listEnv } } },
  };

  const [merchants, users, txs, successTxs] = await Promise.all([
    prisma.adminUser.count({
      where: { role: AdminRole.MERCHANT, deletedAt: null },
    }),
    prisma.user.count({ where: { environment: listEnv } }),
    prisma.transaction.count({ where: txEnvWhere }),
    prisma.transaction.count({
      where: { ...txEnvWhere, status: TxStatus.success },
    }),
  ]);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const txs24h = await prisma.transaction.count({
    where: {
      ...txEnvWhere,
      createdAt: { gte: since },
    },
  });
  res.json({
    viewer_environment: listEnv,
    merchants,
    end_users: users,
    transactions_total: txs,
    transactions_success: successTxs,
    transactions_last_24h: txs24h,
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

  const where = {
    ...(merchantId ? { merchantId } : {}),
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
      ? await prisma.adminUser.findMany({
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
  const users =
    allUserIds.length > 0
      ? await prisma.adminUser.findMany({
          where: { id: { in: allUserIds } },
          select: { id: true, email: true },
        })
      : [];
  const emailById = Object.fromEntries(users.map((u) => [u.id, u.email]));

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
    role: AdminRole.MERCHANT,
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
    prisma.adminUser.count({ where }),
    prisma.adminUser.findMany({
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
        },
        _count: { _all: true },
      }),
      prisma.user.groupBy({
        by: ["merchantId"],
        where: {
          merchantId: { in: ids },
          environment: MerchantGatewayEnv.sandbox,
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
  try {
    const row = await prisma.adminUser.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(password, 10),
        role: AdminRole.MERCHANT,
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
  const existing = await prisma.adminUser.findFirst({
    where: { id, role: AdminRole.MERCHANT },
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
  } else if (nextSupported.length > 0 && !env.gatewayTronUsdtOnly) {
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

  const row = await prisma.adminUser.update({
    where: { id },
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
    api_key: newApiKey,
    sandbox_api_key: newSandboxApiKey,
    message,
  });
});

router.get("/api/v1/admin/merchants/:id", async (req, res) => {
  const id = String(req.params.id ?? "");
  const row = await prisma.adminUser.findFirst({
    where: { id, role: AdminRole.MERCHANT },
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
    },
  });
  if (!row) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const [endUsersLive, endUsersSandbox] = await Promise.all([
    prisma.user.count({
      where: { merchantId: id, environment: MerchantGatewayEnv.live },
    }),
    prisma.user.count({
      where: { merchantId: id, environment: MerchantGatewayEnv.sandbox },
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
    end_users_live: endUsersLive,
    end_users_sandbox: endUsersSandbox,
  });
});

/** Admin-only: issue a portal JWT for the merchant (same shape as POST /auth/login). */
router.post("/api/v1/admin/merchants/:id/impersonate", async (req, res) => {
  const id = String(req.params.id ?? "");
  const row = await prisma.adminUser.findFirst({
    where: { id, role: AdminRole.MERCHANT, deletedAt: null },
    select: {
      id: true,
      email: true,
      displayName: true,
      role: true,
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
  const token = signAuthToken({ sub: row.id, role: row.role });
  res.json({
    token,
    role: row.role,
    email: row.email,
    display_name: row.displayName,
  });
});

router.delete("/api/v1/admin/merchants/:id", async (req, res) => {
  const id = String(req.params.id ?? "");
  const hit = await prisma.adminUser.findFirst({
    where: { id, role: AdminRole.MERCHANT },
  });
  if (!hit) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (hit.deletedAt) {
    res.status(400).json({ error: "already_deleted" });
    return;
  }
  await prisma.adminUser.update({
    where: { id },
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

  const where = {
    environment: listEnv,
    ...(merchantId ? { merchantId } : {}),
    ...(q
      ? {
          OR: [
            { externalUserId: { contains: q, mode: "insensitive" } },
            { id: { contains: q, mode: "insensitive" } },
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
        _count: { select: { wallets: true } },
      },
    }),
  ]);

  res.json({
    page,
    pageSize,
    total,
    viewer_environment: listEnv,
    users: rows.map((u) => ({
      id: u.id,
      external_user_id: u.externalUserId,
      merchant: u.merchant,
      wallets_count: u._count.wallets,
      created_at: u.createdAt,
    })),
  });
});

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

  const walletUserWhere = {
    environment: listEnv,
    ...(merchantId ? { merchantId } : {}),
    ...(qExtUser
      ? {
          externalUserId: { contains: qExtUser, mode: "insensitive" },
        }
      : {}),
  };

  const where = {
    wallet: {
      is: {
        ...(qAddr
          ? qAddr.startsWith("0x")
            ? { address: { equals: qAddr, mode: "insensitive" } }
            : { address: qAddr }
          : {}),
        user: walletUserWhere,
      },
    },
    ...(chain && CHAINS.has(chain) ? { chain } : {}),
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
        wallet: {
          include: {
            user: {
              include: {
                merchant: {
                  select: { id: true, email: true, displayName: true },
                },
              },
            },
          },
        },
      },
    }),
  ]);

  res.json({
    page,
    pageSize,
    total,
    viewer_environment: listEnv,
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
      end_user_id: t.wallet.user.id,
      external_user_id: t.wallet.user.externalUserId,
      gateway_environment: t.wallet.user.environment,
      merchant: t.wallet.user.merchant,
      merchant_id: t.wallet.user.merchant.id,
      merchant_email: t.wallet.user.merchant.email,
      created_at: t.createdAt,
      updated_at: t.updatedAt,
    })),
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
  const from =
    typeof req.query.created_from === "string"
      ? new Date(req.query.created_from)
      : null;
  const to =
    typeof req.query.created_to === "string"
      ? new Date(req.query.created_to)
      : null;

  const userWhere = {
    ...(merchantId ? { merchantId } : {}),
    ...(q
      ? {
          OR: [
            { externalUserId: { contains: q, mode: "insensitive" } },
            { id: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const hasUserScope = merchantId || q;
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

  const where = {
    ...(hasUserScope ? { user: userWhere } : {}),
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
  };

  const [total, rows] = await Promise.all([
    prisma.wallet.count({ where }),
    prisma.wallet.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        _count: { select: { transactions: true } },
        user: {
          include: {
            merchant: { select: { id: true, email: true, displayName: true } },
          },
        },
      },
    }),
  ]);

  const now = new Date();
  const ttlMin = walletScanTtlMinutes();
  res.json({
    page,
    pageSize,
    total,
    deposit_scan_ttl_minutes: ttlMin,
    wallets: rows.map((w) => {
      const txCount = w._count.transactions;
      const exp = w.scanExpiresAt;
      const deposit_scan_active =
        txCount > 0 || exp == null || exp > now;
      return {
        id: w.id,
        address: w.address,
        chain: w.chain,
        currency: w.currency,
        network: w.network,
        derivation_index: w.derivationIndex,
        end_user_id: w.user.id,
        external_user_id: w.user.externalUserId,
        merchant: w.user.merchant,
        created_at: w.createdAt,
        scan_expires_at: exp?.toISOString() ?? null,
        transaction_count: txCount,
        deposit_scan_active,
      };
    }),
  });
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

  const where = {
    ...(merchantId ? { merchantId } : {}),
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

router.get("/api/v1/admin/tron-trx-sweep/targets", async (req, res) => {
  try {
    const data = await listTronTrxSweepTargets();
    res.json(data);
  } catch (e) {
    logger.error("admin tron-trx-sweep targets failed", { err: String(e) });
    res.status(500).json({ error: "server_error", message: String(e) });
  }
});

router.post("/api/v1/admin/tron-trx-sweep/one", async (req, res) => {
  const walletId =
    typeof req.body?.wallet_id === "string" ? req.body.wallet_id.trim() : "";
  if (!walletId) {
    return res.status(400).json({
      error: "validation",
      message: "wallet_id is required",
    });
  }
  try {
    const result = await sweepTronTrxOne(walletId);
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
    logger.error("admin tron-trx-sweep one failed", { walletId, err: String(e) });
    res.status(500).json({ error: "server_error", message: String(e) });
  }
});

router.post("/api/v1/admin/tron-trx-sweep/all", async (req, res) => {
  try {
    const data = await sweepTronTrxAll();
    if (data.configured === false) {
      return res.status(400).json({
        error: "SWEEP_MASTER_TRX_OR_TRON_NOT_SET",
        message:
          "Set SWEEP_MASTER_TRX or SWEEP_MASTER_TRON in server environment for native TRX consolidation.",
      });
    }
    res.json(data);
  } catch (e) {
    logger.error("admin tron-trx-sweep all failed", { err: String(e) });
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
  if (c === "ETH") return Chain.ETH;
  if (c === "BNB") return Chain.BNB;
  return null;
}

router.get("/api/v1/admin/evm-usdt-sweep/targets", async (req, res) => {
  const chain = parseEvmUsdtSweepChainParam(req.query?.chain);
  if (!chain) {
    return res.status(400).json({
      error: "validation",
      message: "Query chain must be ETH or BNB",
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
      message: "body.chain must be ETH or BNB",
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
      message: "body.chain must be ETH or BNB",
    });
  }
  try {
    const data = await sweepEvmUsdtAll(chain);
    if (data.configured === false) {
      const key =
        chain === Chain.ETH ? "SWEEP_MASTER_USDT_ETH" : "SWEEP_MASTER_USDT_BNB";
      return res.status(400).json({
        error: `${key}_NOT_SET`,
        message: `Set ${key} in server environment to your main USDT receive address on ${chain}.`,
      });
    }
    res.json(data);
  } catch (e) {
    logger.error("admin evm-usdt-sweep all failed", { err: String(e) });
    res.status(500).json({ error: "server_error", message: String(e) });
  }
});

router.get("/api/v1/admin/solana-sweep/targets", async (req, res) => {
  try {
    const data = await listSolanaUsdtSweepTargets();
    res.json(data);
  } catch (e) {
    logger.error("admin solana-sweep targets failed", { err: String(e) });
    res.status(500).json({ error: "server_error", message: String(e) });
  }
});

router.post("/api/v1/admin/solana-sweep/one", async (req, res) => {
  const walletId =
    typeof req.body?.wallet_id === "string" ? req.body.wallet_id.trim() : "";
  if (!walletId) {
    return res.status(400).json({
      error: "validation",
      message: "wallet_id is required",
    });
  }
  try {
    const result = await sweepSolanaUsdtOne(walletId);
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
    logger.error("admin solana-sweep one failed", { walletId, err: String(e) });
    res.status(500).json({ error: "server_error", message: String(e) });
  }
});

router.post("/api/v1/admin/solana-sweep/all", async (req, res) => {
  try {
    const data = await sweepSolanaUsdtAll();
    if (data.configured === false) {
      return res.status(400).json({
        error: "SWEEP_MASTER_SOLANA_NOT_SET",
        message:
          "Set SWEEP_MASTER_SOLANA in server environment to your main Solana USDT (SPL) receive address.",
      });
    }
    res.json(data);
  } catch (e) {
    logger.error("admin solana-sweep all failed", { err: String(e) });
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
  const walletId =
    typeof req.body?.wallet_id === "string" ? req.body.wallet_id.trim() : "";
  if (!walletId) {
    return res.status(400).json({
      error: "validation",
      message: "wallet_id is required",
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

export { router as adminRouter };
