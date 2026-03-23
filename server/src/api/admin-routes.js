import { Router } from "express";
import bcrypt from "bcrypt";
import {
  AdminRole,
  Chain,
  Prisma,
  TxStatus,
  WithdrawalStatus,
} from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/require-auth.js";
import { parsePageQuery } from "../lib/pagination.js";
import { generateApiKey, hashApiKey } from "../lib/api-key.js";
import { logger } from "../lib/logger.js";
import { parseDefaultChainsArray } from "../lib/default-chains.js";
import crypto from "crypto";

const router = Router();
const adminOnly = requireAuth(AdminRole.ADMIN);

const CHAINS = new Set(Object.values(Chain));

router.use("/api/v1/admin", adminOnly);

router.get("/api/v1/admin/dashboard", async (_req, res) => {
  const [merchants, users, txs, successTxs] = await Promise.all([
    prisma.adminUser.count({ where: { role: AdminRole.MERCHANT } }),
    prisma.user.count(),
    prisma.transaction.count(),
    prisma.transaction.count({ where: { status: TxStatus.success } }),
  ]);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const txs24h = await prisma.transaction.count({
    where: { createdAt: { gte: since } },
  });
  res.json({
    merchants,
    end_users: users,
    transactions_total: txs,
    transactions_success: successTxs,
    transactions_last_24h: txs24h,
  });
});

router.get("/api/v1/admin/merchants", async (req, res) => {
  const { skip, take, page, pageSize } = parsePageQuery(req.query);
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const isActive =
    req.query.is_active === "true"
      ? true
      : req.query.is_active === "false"
        ? false
        : undefined;

  const where = {
    role: AdminRole.MERCHANT,
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
        callbackUrl: true,
        apiKeyHash: true,
        apiKeyHint: true,
        isActive: true,
        createdAt: true,
        _count: { select: { endUsers: true } },
      },
    }),
  ]);

  res.json({
    page,
    pageSize,
    total,
    merchants: rows.map((m) => ({
      id: m.id,
      email: m.email,
      display_name: m.displayName,
      default_chains: m.defaultChains,
      callback_url: m.callbackUrl,
      api_key_hash: m.apiKeyHash,
      api_key_hint: m.apiKeyHint,
      is_active: m.isActive,
      created_at: m.createdAt,
      end_users_count: m._count.endUsers,
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
  const parsedChains = parseDefaultChainsArray(body.default_chains, { minOne: true });
  if ("error" in parsedChains && parsedChains.error) {
    res.status(400).json({ error: parsedChains.error });
    return;
  }
  const password = body.password?.trim() || crypto.randomBytes(12).toString("base64url");
  const apiSecret = generateApiKey();
  try {
    const row = await prisma.adminUser.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(password, 10),
        role: AdminRole.MERCHANT,
        displayName: body.display_name?.trim() || null,
        defaultChains: parsedChains.chains,
        callbackUrl: body.callback_url?.trim() || null,
        apiKeyHash: hashApiKey(apiSecret),
        apiKeyHint: apiSecret.slice(-6),
      },
    });
    res.status(201).json({
      id: row.id,
      email: row.email,
      display_name: row.displayName,
      default_chains: row.defaultChains,
      callback_url: row.callbackUrl,
      temporary_password: body.password?.trim() ? undefined : password,
      api_key: apiSecret,
      message: "Store api_key once; it cannot be retrieved later.",
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
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

  let newApiKey;
  const data = {};
  if (body.display_name !== undefined) data.displayName = body.display_name;
  if (body.callback_url !== undefined) data.callbackUrl = body.callback_url;
  if (typeof body.is_active === "boolean") data.isActive = body.is_active;
  if (body.default_chains !== undefined) {
    const parsedChains = parseDefaultChainsArray(body.default_chains, { minOne: true });
    if ("error" in parsedChains) {
      res.status(400).json({ error: parsedChains.error });
      return;
    }
    data.defaultChains = parsedChains.chains;
  }
  if (body.password?.trim()) {
    data.passwordHash = await bcrypt.hash(body.password.trim(), 10);
  }
  if (body.regenerate_api_key) {
    newApiKey = generateApiKey();
    data.apiKeyHash = hashApiKey(newApiKey);
    data.apiKeyHint = newApiKey.slice(-6);
  }

  const row = await prisma.adminUser.update({
    where: { id },
    data,
    select: {
      id: true,
      email: true,
      displayName: true,
      defaultChains: true,
      callbackUrl: true,
      apiKeyHint: true,
      isActive: true,
    },
  });
  res.json({
    id: row.id,
    email: row.email,
    display_name: row.displayName,
    default_chains: row.defaultChains,
    callback_url: row.callbackUrl,
    api_key_hint: row.apiKeyHint,
    is_active: row.isActive,
    api_key: newApiKey,
    message: newApiKey ? "New api_key returned once." : undefined,
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
      callbackUrl: true,
      apiKeyHint: true,
      isActive: true,
      createdAt: true,
      _count: { select: { endUsers: true } },
    },
  });
  if (!row) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({
    id: row.id,
    email: row.email,
    display_name: row.displayName,
    default_chains: row.defaultChains,
    callback_url: row.callbackUrl,
    api_key_hint: row.apiKeyHint,
    is_active: row.isActive,
    created_at: row.createdAt,
    end_users_count: row._count.endUsers,
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
  await prisma.adminUser.update({ where: { id }, data: { isActive: false } });
  res.json({ ok: true });
});

router.get("/api/v1/admin/users", async (req, res) => {
  const { skip, take, page, pageSize } = parsePageQuery(req.query);
  const merchantId =
    typeof req.query.merchant_id === "string" ? req.query.merchant_id.trim() : "";
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const from =
    typeof req.query.created_from === "string" ? new Date(req.query.created_from) : null;
  const to =
    typeof req.query.created_to === "string" ? new Date(req.query.created_to) : null;

  const where = {
    ...(merchantId ? { merchantId } : {}),
    ...(q
      ? {
          OR: [
            { externalUserId: { contains: q, mode: "insensitive" } },
            { id: { contains: q, mode: "insensitive" } },
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
        merchant: { select: { id: true, email: true, displayName: true } },
        _count: { select: { wallets: true } },
      },
    }),
  ]);

  res.json({
    page,
    pageSize,
    total,
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
  const merchantId =
    typeof req.query.merchant_id === "string" ? req.query.merchant_id.trim() : "";
  const chain = typeof req.query.chain === "string" ? req.query.chain.trim() : "";
  const status = typeof req.query.status === "string" ? req.query.status.trim() : "";
  const token =
    typeof req.query.token_symbol === "string" ? req.query.token_symbol.trim() : "";
  const qAddr = typeof req.query.address === "string" ? req.query.address.trim() : "";

  const where = {
    ...(merchantId || qAddr
      ? {
          wallet: {
            is: {
              ...(qAddr
                ? qAddr.startsWith("0x")
                  ? { address: { equals: qAddr, mode: "insensitive" } }
                  : { address: qAddr }
                : {}),
              ...(merchantId ? { user: { merchantId } } : {}),
            },
          },
        }
      : {}),
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
              include: { merchant: { select: { id: true, email: true, displayName: true } } },
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
    transactions: rows.map((t) => ({
      id: t.id,
      tx_hash: t.txHash,
      chain: t.chain,
      status: t.status,
      token_symbol: t.tokenSymbol,
      token_decimals: t.tokenDecimals,
      amount: t.amount,
      confirmations: t.confirmations,
      from_address: t.fromAddress,
      to_address: t.toAddress,
      wallet_address: t.wallet.address,
      end_user_id: t.wallet.user.id,
      external_user_id: t.wallet.user.externalUserId,
      merchant: t.wallet.user.merchant,
      created_at: t.createdAt,
    })),
  });
});

router.get("/api/v1/admin/withdrawals", async (req, res) => {
  const { skip, take, page, pageSize } = parsePageQuery(req.query);
  const merchantId =
    typeof req.query.merchant_id === "string" ? req.query.merchant_id.trim() : "";
  const chain = typeof req.query.chain === "string" ? req.query.chain.trim() : "";
  const status = typeof req.query.status === "string" ? req.query.status.trim() : "";
  const token =
    typeof req.query.token_symbol === "string" ? req.query.token_symbol.trim() : "";
  const toAddr =
    typeof req.query.to_address === "string" ? req.query.to_address.trim() : "";

  const where = {
    ...(merchantId ? { merchantId } : {}),
    ...(chain && CHAINS.has(chain) ? { chain } : {}),
    ...(status && Object.values(WithdrawalStatus).includes(status) ? { status } : {}),
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

export { router as adminRouter };
