import { Router } from "express";
import { formatAtomicAmountString } from "../lib/format-atomic-amount.js";
import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";
import { createOrGetWallet } from "../services/wallet/wallet-service.js";
import { logger } from "../lib/logger.js";
import { resolveMerchantByGatewayApiKey } from "../lib/gateway-merchant-auth.js";
import { simulateSandboxDeposit } from "../services/payment/sandbox-deposit.js";
import {
  assertMerchantGatewayKeyAllowed,
  gatewayEnvironmentFromKeyType,
  parseGatewayEnvironmentFromBody,
} from "../lib/merchant-gateway-env.js";
import {
  listMerchantSupportedCurrencyPairs,
  merchantChainAllowsRail,
  normalizeAssetPart,
  resolveDepositRail,
} from "../config/payment-rails.js";

const router = Router();

router.post("/api/v1/gateway/deposit-address", async (req, res) => {
  try {
    const body = req.body ?? {};
    const apiKey = body.api_key?.trim();
    const externalUserId = body.external_user_id?.trim();
    if (!apiKey || !externalUserId) {
      res.status(400).json({ error: "api_key and external_user_id are required" });
      return;
    }

    const gwEnvHint = parseGatewayEnvironmentFromBody(body);
    const resolved = await resolveMerchantByGatewayApiKey(apiKey, {
      gatewayEnvironment: gwEnvHint,
    });
    if (!resolved) {
      res.status(401).json({ error: "invalid_api_key" });
      return;
    }
    const { merchant, keyType } = resolved;
    const gate = assertMerchantGatewayKeyAllowed(merchant, keyType);
    if (!gate.ok) {
      res.status(403).json({ error: gate.error, message: gate.message });
      return;
    }
    const gwEnv = gatewayEnvironmentFromKeyType(keyType);

    let currency = normalizeAssetPart(body.currency);
    let network = normalizeAssetPart(body.network);
    if (!currency || !network) {
      currency = normalizeAssetPart(merchant.defaultCurrency);
      network = normalizeAssetPart(merchant.defaultNetwork);
    }
    if (!currency || !network) {
      res.status(500).json({ error: "merchant_default_pair_misconfigured" });
      return;
    }

    const rail = resolveDepositRail(currency, network);
    if (!rail) {
      res.status(400).json({ error: "unsupported_currency_network" });
      return;
    }
    if (!merchantChainAllowsRail(merchant, rail)) {
      res.status(403).json({ error: "rail_not_enabled_for_merchant" });
      return;
    }

    let user = await prisma.user.findUnique({
      where: {
        merchantId_externalUserId_environment: {
          merchantId: merchant.id,
          externalUserId,
          environment: gwEnv,
        },
      },
    });
    let createdNewUser = false;
    if (!user) {
      user = await prisma.user.create({
        data: {
          merchantId: merchant.id,
          externalUserId,
          environment: gwEnv,
        },
      });
      createdNewUser = true;
    }

    const wallet = await createOrGetWallet(
      user.id,
      rail.chain,
      rail.currency,
      rail.network,
    );
    res.status(200).json({
      address: wallet.address,
      chain: wallet.chain,
      currency: wallet.currency,
      network: wallet.network,
      wallet_id: wallet.id,
      user_id: user.id,
      merchant_id: merchant.id,
      created_new_user: createdNewUser,
      gateway_environment: gwEnv,
    });
  } catch (e) {
    logger.error("gateway deposit-address failed", { err: String(e) });
    res.status(500).json({ error: "internal error" });
  }
});

router.post("/api/v1/gateway/supported-currency", async (req, res) => {
  try {
    const body = req.body ?? {};
    const apiKey = body.api_key?.trim();
    if (!apiKey) {
      res.status(400).json({ error: "api_key is required" });
      return;
    }

    const gwEnvHint = parseGatewayEnvironmentFromBody(body);
    const resolved = await resolveMerchantByGatewayApiKey(apiKey, {
      gatewayEnvironment: gwEnvHint,
    });
    if (!resolved) {
      res.status(401).json({ error: "invalid_api_key" });
      return;
    }
    const { merchant, keyType } = resolved;
    const gate = assertMerchantGatewayKeyAllowed(merchant, keyType);
    if (!gate.ok) {
      res.status(403).json({ error: gate.error, message: gate.message });
      return;
    }

    const pairs = listMerchantSupportedCurrencyPairs(merchant);
    res.status(200).json({
      pairs,
      default_currency: normalizeAssetPart(merchant.defaultCurrency),
      default_network: normalizeAssetPart(merchant.defaultNetwork),
      gateway_environment: gatewayEnvironmentFromKeyType(keyType),
    });
  } catch (e) {
    logger.error("gateway supported-currency failed", { err: String(e) });
    res.status(500).json({ error: "internal error" });
  }
});

router.post("/api/v1/gateway/create-wallet", async (req, res) => {
  try {
    const body = req.body ?? {};
    const apiKey = body.api_key?.trim();
    const userId = body.user_id?.trim();
    const currency = normalizeAssetPart(body.currency);
    const network = normalizeAssetPart(body.network);
    if (!apiKey || !userId || !currency || !network) {
      res
        .status(400)
        .json({ error: "api_key, user_id, currency and network are required" });
      return;
    }

    const rail = resolveDepositRail(currency, network);
    if (!rail) {
      res.status(400).json({ error: "unsupported_currency_network" });
      return;
    }

    const gwEnvHint = parseGatewayEnvironmentFromBody(body);
    const resolved = await resolveMerchantByGatewayApiKey(apiKey, {
      gatewayEnvironment: gwEnvHint,
    });
    if (!resolved) {
      res.status(401).json({ error: "invalid_api_key" });
      return;
    }
    const { merchant, keyType } = resolved;
    const gate = assertMerchantGatewayKeyAllowed(merchant, keyType);
    if (!gate.ok) {
      res.status(403).json({ error: gate.error, message: gate.message });
      return;
    }
    const gwEnv = gatewayEnvironmentFromKeyType(keyType);
    if (!merchantChainAllowsRail(merchant, rail)) {
      res.status(403).json({ error: "rail_not_enabled_for_merchant" });
      return;
    }

    const user = await prisma.user.findFirst({
      where: { id: userId, merchantId: merchant.id, environment: gwEnv },
    });
    if (!user) {
      res.status(404).json({ error: "user not found" });
      return;
    }

    const wallet = await createOrGetWallet(
      user.id,
      rail.chain,
      rail.currency,
      rail.network,
    );
    res.status(200).json({
      address: wallet.address,
      chain: wallet.chain,
      currency: wallet.currency,
      network: wallet.network,
      wallet_id: wallet.id,
      gateway_environment: gwEnv,
    });
  } catch (e) {
    const msg = String(e);
    if (msg.includes("USER_NOT_FOUND")) {
      res.status(404).json({ error: "user not found" });
      return;
    }
    logger.error("gateway create-wallet failed", { err: msg });
    res.status(500).json({ error: "internal error" });
  }
});

router.get("/api/v1/gateway/transactions", async (req, res) => {
  const address =
    typeof req.query.address === "string" ? req.query.address.trim() : "";
  if (!address) {
    res.status(400).json({ error: "address query param required" });
    return;
  }

  const currencyF = normalizeAssetPart(
    typeof req.query.currency === "string" ? req.query.currency : "",
  );
  const networkF = normalizeAssetPart(
    typeof req.query.network === "string" ? req.query.network : "",
  );

  const wallets = await prisma.wallet.findMany({
    where: {
      ...(address.startsWith("0x")
        ? { address: { equals: address, mode: "insensitive" } }
        : { address }),
      ...(currencyF && networkF
        ? { currency: currencyF, network: networkF }
        : {}),
    },
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
    include: {
      wallet: {
        select: {
          currency: true,
          network: true,
          user: { select: { environment: true } },
        },
      },
    },
  });

  res.json({
    transactions: txs.map((t) => ({
      id: t.id,
      tx_hash: t.txHash,
      from_address: t.fromAddress,
      to_address: t.toAddress,
      amount: t.amount,
      amount_decimal: formatAtomicAmountString(t.amount, t.tokenDecimals),
      token_symbol: t.tokenSymbol,
      token_decimals: t.tokenDecimals,
      chain: t.chain,
      currency: t.wallet.currency,
      network: t.wallet.network,
      status: t.status,
      confirmations: t.confirmations,
      block_number: t.blockNumber?.toString() ?? null,
      created_at: t.createdAt,
      updated_at: t.updatedAt,
      gateway_environment: t.wallet.user.environment,
    })),
  });
});

router.post("/api/v1/gateway/sandbox/simulate-deposit", async (req, res) => {
  try {
    const body = req.body ?? {};
    const apiKey = body.api_key?.trim();
    const walletId = body.wallet_id?.trim();
    if (!apiKey || !walletId) {
      res.status(400).json({ error: "api_key and wallet_id are required" });
      return;
    }

    const resolved = await resolveMerchantByGatewayApiKey(apiKey, {
      gatewayEnvironment: "sandbox",
    });
    if (!resolved) {
      res.status(401).json({ error: "invalid_api_key" });
      return;
    }
    const { merchant, keyType } = resolved;
    if (keyType !== "sandbox" && !env.gatewaySandbox) {
      res.status(403).json({
        error: "sandbox_api_key_required",
        message:
          "simulate-deposit only runs against sandbox data. If your account still uses a separate live-only secret, use the sandbox secret. Or set GATEWAY_SANDBOX=true for local development.",
      });
      return;
    }
    const gate = assertMerchantGatewayKeyAllowed(merchant, "sandbox");
    if (!gate.ok) {
      res.status(403).json({ error: gate.error, message: gate.message });
      return;
    }

    const amount =
      typeof body.amount === "string" || typeof body.amount === "number"
        ? String(body.amount).trim()
        : "";

    const out = await simulateSandboxDeposit({
      merchantId: merchant.id,
      walletId,
      amount: amount || undefined,
    });
    logger.info("gateway sandbox simulate-deposit", {
      merchantId: merchant.id,
      walletId,
      txHash: out.tx_hash,
      keyType,
    });
    res.status(200).json(out);
  } catch (e) {
    if (/** @type {any} */ (e).code === "WALLET_NOT_FOUND") {
      res.status(404).json({ error: "wallet_not_found" });
      return;
    }
    logger.error("gateway sandbox simulate-deposit failed", { err: String(e) });
    res.status(500).json({ error: "internal error" });
  }
});

export { router as gatewayRouter };
