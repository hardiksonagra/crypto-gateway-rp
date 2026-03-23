import { Router, Request, Response } from "express";
import { Chain, Prisma, type User } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { createOrGetWallet } from "../services/wallet/wallet-service.js";
import { logger } from "../lib/logger.js";
import { integratorIdentityEmail } from "../lib/integrator-user.js";

const router = Router();

const CHAINS = new Set<string>(Object.values(Chain));

/**
 * HTTP surface area kept intentionally small — add auth/rate-limits at the edge (API gateway).
 */

/**
 * Single entry: ensure user exists, return deposit address for `chain`.
 * - Integrator: `merchant_ref` + `external_user_id` + `chain` (+ optional `callback_url`).
 * - Email: `email` + `chain` (+ optional `callback_url`) — creates user on first sight.
 * Wallet row is idempotent via createOrGetWallet.
 */
router.post("/api/deposit-address", async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      merchant_ref?: string;
      external_user_id?: string;
      callback_url?: string;
      chain?: string;
      email?: string;
    };
    const { merchant_ref, external_user_id, callback_url, chain, email } = body;
    if (!chain) {
      res.status(400).json({ error: "chain is required" });
      return;
    }
    if (!CHAINS.has(chain)) {
      res.status(400).json({ error: `unsupported chain: ${chain}` });
      return;
    }

    const merchantOk = Boolean(merchant_ref?.trim() && external_user_id?.trim());
    const emailOk = Boolean(email?.trim());
    if (!merchantOk && !emailOk) {
      res.status(400).json({
        error: "provide either (merchant_ref + external_user_id) or email",
      });
      return;
    }

    let user: User;
    let createdNewUser = false;

    if (merchantOk) {
      const syntheticEmail = integratorIdentityEmail(merchant_ref!, external_user_id!);
      let u = await prisma.user.findUnique({ where: { email: syntheticEmail } });
      if (!u) {
        u = await prisma.user.create({
          data: {
            email: syntheticEmail,
            callbackUrl: callback_url?.trim() || null,
            merchantRef: merchant_ref!.trim(),
            externalUserId: external_user_id!.trim(),
          },
        });
        createdNewUser = true;
      } else if (callback_url?.trim()) {
        u = await prisma.user.update({
          where: { id: u.id },
          data: { callbackUrl: callback_url.trim() },
        });
      }
      user = u;
    } else {
      const em = email!.trim();
      let u = await prisma.user.findUnique({ where: { email: em } });
      if (!u) {
        try {
          u = await prisma.user.create({
            data: { email: em, callbackUrl: callback_url?.trim() || null },
          });
          createdNewUser = true;
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
            u = await prisma.user.findUnique({ where: { email: em } });
          }
          if (!u) throw e;
        }
      } else if (callback_url?.trim()) {
        u = await prisma.user.update({
          where: { id: u.id },
          data: { callbackUrl: callback_url.trim() },
        });
      }
      if (!u) {
        res.status(500).json({ error: "internal error" });
        return;
      }
      user = u;
    }

    const wallet = await createOrGetWallet(user.id, chain as Chain);
    res.status(200).json({
      address: wallet.address,
      chain: wallet.chain,
      wallet_id: wallet.id,
      user_id: user.id,
      created_new_user: createdNewUser,
    });
  } catch (e) {
    const msg = String(e);
    if (msg.includes("INVALID_MERCHANT_OR_USER_REF")) {
      res.status(400).json({ error: "invalid merchant_ref or external_user_id" });
      return;
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P1001" || e.code === "P1003") {
        logger.error("deposit-address: database unreachable", { code: e.code });
        res.status(503).json({ error: "database unavailable" });
        return;
      }
    }
    logger.error("deposit-address failed", { err: msg });
    res.status(500).json({ error: "internal error" });
  }
});

router.post("/api/create-wallet", async (req: Request, res: Response) => {
  try {
    const { user_id, chain } = req.body as { user_id?: string; chain?: string };
    if (!user_id || !chain) {
      res.status(400).json({ error: "user_id and chain required" });
      return;
    }
    if (!CHAINS.has(chain)) {
      res.status(400).json({ error: `unsupported chain: ${chain}` });
      return;
    }
    const wallet = await createOrGetWallet(user_id, chain as Chain);
    res.status(200).json({ address: wallet.address, chain: wallet.chain, wallet_id: wallet.id });
  } catch (e) {
    const msg = String(e);
    if (msg.includes("USER_NOT_FOUND")) {
      res.status(404).json({ error: "user not found" });
      return;
    }
    logger.error("create-wallet failed", { err: msg });
    res.status(500).json({ error: "internal error" });
  }
});

router.get("/api/transactions", async (req: Request, res: Response) => {
  const address = typeof req.query.address === "string" ? req.query.address.trim() : "";
  if (!address) {
    res.status(400).json({ error: "address query param required" });
    return;
  }

  const wallets = await prisma.wallet.findMany({
    where: address.startsWith("0x")
      ? { address: { equals: address, mode: "insensitive" } }
      : { address },
    select: { id: true },
  });
  if (wallets.length === 0) {
    res.json({ transactions: [] });
    return;
  }

  const txs = await prisma.transaction.findMany({
    where: { walletId: { in: wallets.map((w) => w.id) } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  res.json({
    transactions: txs.map((t) => ({
      id: t.id,
      tx_hash: t.txHash,
      from_address: t.fromAddress,
      to_address: t.toAddress,
      amount: t.amount,
      token_symbol: t.tokenSymbol,
      token_decimals: t.tokenDecimals,
      chain: t.chain,
      status: t.status,
      confirmations: t.confirmations,
      block_number: t.blockNumber?.toString() ?? null,
      created_at: t.createdAt,
      updated_at: t.updatedAt,
    })),
  });
});

router.get("/health", (_req, res) => {
  res.json({ ok: true });
});

export { router as apiRouter };
