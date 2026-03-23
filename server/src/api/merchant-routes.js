import { Router } from "express";
import { AdminRole, Chain, TxStatus, WithdrawalStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/require-auth.js";
import { parsePageQuery } from "../lib/pagination.js";
import {
  computeMerchantBalances,
  merchantBalanceForAsset,
} from "../services/merchant-balance.js";
import { isEvmChain } from "../config/chains.js";
import { nativeSymbolForChain } from "../services/native-symbols.js";
import { sendEvmNativeFromMerchantPool } from "../services/withdraw/evm-native-withdraw.js";
import { logger } from "../lib/logger.js";
import { parseDefaultChainsArray } from "../lib/default-chains.js";
import { ethers } from "ethers";

const CHAIN_SET = new Set(Object.values(Chain));

const router = Router();
const merchantOnly = requireAuth(AdminRole.MERCHANT);

router.use("/api/v1/merchant", merchantOnly);

function merchantId(req) {
  return req.auth?.sub;
}

router.get("/api/v1/merchant/dashboard", async (req, res) => {
  const mid = merchantId(req);
  if (!mid) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const balances = await computeMerchantBalances(mid);
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recent = await prisma.transaction.findMany({
    where: { wallet: { user: { merchantId: mid } }, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 8,
    include: {
      wallet: { select: { address: true } },
    },
  });
  const [users, txs] = await Promise.all([
    prisma.user.count({ where: { merchantId: mid } }),
    prisma.transaction.count({ where: { wallet: { user: { merchantId: mid } } } }),
  ]);
  res.json({
    balances,
    stats: { end_users: users, transactions: txs },
    recent_transactions: recent.map((t) => ({
      id: t.id,
      tx_hash: t.txHash,
      chain: t.chain,
      status: t.status,
      token_symbol: t.tokenSymbol,
      amount: t.amount,
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
  const { skip, take, page, pageSize } = parsePageQuery(req.query);
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const where = {
    merchantId: mid,
    ...(q
      ? {
          OR: [
            { externalUserId: { contains: q, mode: "insensitive" } },
            { id: { contains: q, mode: "insensitive" } },
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
      include: { _count: { select: { wallets: true } } },
    }),
  ]);
  res.json({
    page,
    pageSize,
    total,
    users: rows.map((u) => ({
      id: u.id,
      external_user_id: u.externalUserId,
      wallets_count: u._count.wallets,
      created_at: u.createdAt,
    })),
  });
});

router.get("/api/v1/merchant/transactions", async (req, res) => {
  const mid = merchantId(req);
  if (!mid) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const { skip, take, page, pageSize } = parsePageQuery(req.query);
  const chain = typeof req.query.chain === "string" ? req.query.chain.trim() : "";
  const status = typeof req.query.status === "string" ? req.query.status.trim() : "";
  const token =
    typeof req.query.token_symbol === "string" ? req.query.token_symbol.trim() : "";
  const qUser =
    typeof req.query.external_user_id === "string"
      ? req.query.external_user_id.trim()
      : "";

  const where = {
    wallet: {
      is: {
        user: {
          merchantId: mid,
          ...(qUser ? { externalUserId: { contains: qUser, mode: "insensitive" } } : {}),
        },
      },
    },
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
        wallet: { include: { user: { select: { externalUserId: true } } } },
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
      external_user_id: t.wallet.user.externalUserId,
      created_at: t.createdAt,
    })),
  });
});

router.get("/api/v1/merchant/withdrawals", async (req, res) => {
  const mid = merchantId(req);
  if (!mid) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const { skip, take, page, pageSize } = parsePageQuery(req.query);
  const chain = typeof req.query.chain === "string" ? req.query.chain.trim() : "";
  const status = typeof req.query.status === "string" ? req.query.status.trim() : "";
  const token =
    typeof req.query.token_symbol === "string" ? req.query.token_symbol.trim() : "";
  const toAddr =
    typeof req.query.to_address === "string" ? req.query.to_address.trim() : "";

  const where = {
    merchantId: mid,
    ...(chain && CHAIN_SET.has(chain) ? { chain } : {}),
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
  const body = req.body ?? {};
  const chainStr = body.chain?.trim();
  const to = body.to_address?.trim();
  const amountStr = body.amount?.trim();
  const tokenSymbol = body.token_symbol?.trim();
  if (!chainStr || !to || !amountStr || !tokenSymbol) {
    res.status(400).json({ error: "chain, to_address, amount, token_symbol required" });
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
    res.status(400).json({ error: "insufficient_balance", available_raw: available.toString() });
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
        merchantId: mid,
        chain,
        tokenSymbol: expectedNative,
        toAddress: checksumTo,
        amount: amountStr,
        status: WithdrawalStatus.processing,
      },
    });
    wId = row.id;
    const { txHash, fromAddress } = await sendEvmNativeFromMerchantPool({
      merchantId: mid,
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
        where: { id: wId, merchantId: mid },
        data: { status: WithdrawalStatus.failed, failureReason: msg.slice(0, 2000) },
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
    res.status(500).json({ error: "withdraw_failed", detail: msg.slice(0, 500) });
  }
});

router.patch("/api/v1/merchant/settings", async (req, res) => {
  const mid = merchantId(req);
  if (!mid) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const body = req.body ?? {};
  const data = {};
  if (body.callback_url !== undefined) data.callbackUrl = body.callback_url;
  if (body.default_chains !== undefined) {
    const parsedChains = parseDefaultChainsArray(body.default_chains, { minOne: true });
    if ("error" in parsedChains) {
      res.status(400).json({ error: parsedChains.error });
      return;
    }
    data.defaultChains = parsedChains.chains;
  }
  if (Object.keys(data).length === 0) {
    res.status(400).json({ error: "no_updates" });
    return;
  }
  await prisma.adminUser.update({ where: { id: mid }, data });
  res.json({ ok: true });
});

export { router as merchantRouter };
