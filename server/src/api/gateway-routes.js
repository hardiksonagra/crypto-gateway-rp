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
import {
  redactGatewayBody,
  requestClientIp,
  writeAuditLog,
} from "../services/audit-log.js";
import { createPaymentLinkToken, verifyPaymentLinkToken } from "../lib/payment-link-token.js";
import { normalizeGatewayRedirectUrl } from "../lib/payment-redirect-url.js";
import { walletScanTtlMinutes } from "../lib/wallet-scan.js";

const router = Router();

function paymentPageBaseUrl() {
  const raw = env.paymentPagePublicUrl.trim() || env.appPublicUrl;
  return String(raw).replace(/\/+$/, "");
}

/**
 * @param {import("express").Request} req
 * @param {object} partial
 */
function auditGatewayApi(req, partial) {
  writeAuditLog({
    source: "gateway_api",
    requestMethod: req.method,
    requestPath: (req.originalUrl ?? req.path ?? "").split("?")[0],
    ipAddress: requestClientIp(req),
    ...partial,
  });
}

router.get("/api/v1/gateway/payment-session/:token", async (req, res) => {
  try {
    const rawToken =
      typeof req.params.token === "string" ? req.params.token.trim() : "";
    const v = verifyPaymentLinkToken(rawToken);
    if (!v) {
      res.status(410).json({ error: "payment_link_invalid_or_expired" });
      return;
    }
    const redirectUrl =
      v.redirectUrl != null && String(v.redirectUrl).trim()
        ? normalizeGatewayRedirectUrl(v.redirectUrl)
        : null;
    const w = await prisma.wallet.findUnique({
      where: { id: v.walletId },
      select: {
        address: true,
        chain: true,
        currency: true,
        network: true,
        scanExpiresAt: true,
      },
    });
    if (!w) {
      res.status(410).json({ error: "payment_link_invalid_or_expired" });
      return;
    }
    res.json({
      address: w.address,
      chain: w.chain,
      currency: w.currency,
      network: w.network,
      deposit_scan_expires_at: w.scanExpiresAt?.toISOString() ?? null,
      deposit_scan_ttl_minutes: walletScanTtlMinutes(),
      redirect_url: redirectUrl,
    });
  } catch (e) {
    logger.error("gateway payment-session failed", { err: String(e) });
    res.status(500).json({ error: "internal error" });
  }
});

router.post("/api/v1/gateway/deposit-address", async (req, res) => {
  try {
    const body = req.body ?? {};
    const apiKey = body.api_key?.trim();
    const externalUserId = body.external_user_id?.trim();
    if (!apiKey || !externalUserId) {
      auditGatewayApi(req, {
        action: "deposit_address",
        merchantId: null,
        actorType: "gateway_api_key",
        summary: "deposit-address 400 — missing api_key or external_user_id",
        metadata: { request_in: redactGatewayBody(body), http_status: 400 },
      });
      res.status(400).json({ error: "api_key and external_user_id are required" });
      return;
    }

    const gwEnvHint = parseGatewayEnvironmentFromBody(body);
    const resolved = await resolveMerchantByGatewayApiKey(apiKey, {
      gatewayEnvironment: gwEnvHint,
    });
    if (!resolved) {
      auditGatewayApi(req, {
        action: "deposit_address",
        merchantId: null,
        actorType: "gateway_api_key",
        summary: "deposit-address 401 — invalid_api_key",
        metadata: {
          request_in: redactGatewayBody(body),
          http_status: 401,
          external_user_id: externalUserId,
        },
      });
      res.status(401).json({ error: "invalid_api_key" });
      return;
    }
    const { merchant, keyType } = resolved;
    const gate = assertMerchantGatewayKeyAllowed(merchant, keyType);
    if (!gate.ok) {
      auditGatewayApi(req, {
        action: "deposit_address",
        merchantId: merchant.id,
        actorType: "gateway_api_key",
        summary: `deposit-address 403 — ${gate.error}`,
        metadata: {
          request_in: redactGatewayBody(body),
          http_status: 403,
          external_user_id: externalUserId,
        },
      });
      res.status(403).json({ error: gate.error, message: gate.message });
      return;
    }
    const gwEnv = gatewayEnvironmentFromKeyType(keyType);

    let currency = normalizeAssetPart(body.currency);
    let network = normalizeAssetPart(body.network);
    const bodySpecifiedCurrencyNetwork = Boolean(currency && network);
    if (!currency || !network) {
      currency = normalizeAssetPart(merchant.defaultCurrency);
      network = normalizeAssetPart(merchant.defaultNetwork);
    }
    if (env.gatewayTronUsdtOnly && !bodySpecifiedCurrencyNetwork) {
      const p = listMerchantSupportedCurrencyPairs(merchant)[0];
      if (p) {
        currency = p.currency;
        network = p.network;
      }
    }
    if (!currency || !network) {
      auditGatewayApi(req, {
        action: "deposit_address",
        merchantId: merchant.id,
        actorType: "gateway_api_key",
        summary: "deposit-address 500 — merchant_default_pair_misconfigured",
        metadata: { request_in: redactGatewayBody(body), http_status: 500 },
      });
      res.status(500).json({ error: "merchant_default_pair_misconfigured" });
      return;
    }

    const rail = resolveDepositRail(currency, network);
    if (!rail) {
      auditGatewayApi(req, {
        action: "deposit_address",
        merchantId: merchant.id,
        actorType: "gateway_api_key",
        summary: `deposit-address 400 — unsupported ${currency}/${network}`,
        metadata: {
          request_in: redactGatewayBody(body),
          http_status: 400,
          external_user_id: externalUserId,
        },
      });
      res.status(400).json({ error: "unsupported_currency_network" });
      return;
    }
    if (!merchantChainAllowsRail(merchant, rail)) {
      auditGatewayApi(req, {
        action: "deposit_address",
        merchantId: merchant.id,
        actorType: "gateway_api_key",
        summary: "deposit-address 403 — rail_not_enabled_for_merchant",
        metadata: {
          request_in: redactGatewayBody(body),
          http_status: 403,
          external_user_id: externalUserId,
          currency,
          network,
        },
      });
      res.status(403).json({ error: "rail_not_enabled_for_merchant" });
      return;
    }

    let redirectUrl = null;
    if (body.redirect_url != null && String(body.redirect_url).trim()) {
      redirectUrl = normalizeGatewayRedirectUrl(body.redirect_url);
      if (!redirectUrl) {
        auditGatewayApi(req, {
          action: "deposit_address",
          merchantId: merchant.id,
          actorType: "gateway_api_key",
          summary: "deposit-address 400 — invalid_redirect_url",
          metadata: {
            request_in: redactGatewayBody(body),
            http_status: 400,
            external_user_id: externalUserId,
          },
        });
        res.status(400).json({ error: "invalid_redirect_url" });
        return;
      }
    }

    const { user, wallet, createdNewUser } = await prisma.$transaction(
      async (tx) => {
        let u = await tx.user.findUnique({
          where: {
            merchantId_externalUserId_environment: {
              merchantId: merchant.id,
              externalUserId,
              environment: gwEnv,
            },
          },
        });
        let created = false;
        if (!u) {
          u = await tx.user.create({
            data: {
              merchantId: merchant.id,
              externalUserId,
              environment: gwEnv,
            },
          });
          created = true;
        }
        const w = await createOrGetWallet(
          u.id,
          rail.chain,
          rail.currency,
          rail.network,
          tx,
        );
        return { user: u, wallet: w, createdNewUser: created };
      },
    );
    const responseOut = {
      status: 200,
      wallet_id: wallet.id,
      user_id: user.id,
      merchant_id: merchant.id,
      created_new_user: createdNewUser,
      gateway_environment: gwEnv,
      chain: wallet.chain,
      currency: wallet.currency,
      network: wallet.network,
      address_preview: `${String(wallet.address).slice(0, 14)}…`,
    };
    auditGatewayApi(req, {
      action: "deposit_address",
      merchantId: merchant.id,
      actorType: "gateway_api_key",
      summary: `deposit-address 200 · ext=${externalUserId} · ${wallet.chain} ${wallet.currency}/${wallet.network} · new_user=${createdNewUser}`,
      metadata: {
        request_in: redactGatewayBody(body),
        response_out: {
          ...responseOut,
          payment_link: true,
        },
        occurred_at_iso: new Date().toISOString(),
      },
    });
    const payToken = createPaymentLinkToken(wallet.id, redirectUrl);
    const payBase = paymentPageBaseUrl();
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
      payment_link: `${payBase}/pay/${payToken}`,
      deposit_scan_expires_at: wallet.scanExpiresAt?.toISOString() ?? null,
      deposit_scan_ttl_minutes: walletScanTtlMinutes(),
      redirect_url: redirectUrl,
    });
  } catch (e) {
    logger.error("gateway deposit-address failed", { err: String(e) });
    auditGatewayApi(req, {
      action: "deposit_address",
      merchantId: null,
      actorType: "gateway_api_key",
      summary: "deposit-address 500 — internal error",
      metadata: {
        request_in: redactGatewayBody(req.body ?? {}),
        http_status: 500,
        error: String(e).slice(0, 500),
      },
    });
    res.status(500).json({ error: "internal error" });
  }
});

router.post("/api/v1/gateway/supported-currency", async (req, res) => {
  try {
    const body = req.body ?? {};
    const apiKey = body.api_key?.trim();
    if (!apiKey) {
      auditGatewayApi(req, {
        action: "supported_currency",
        merchantId: null,
        actorType: "gateway_api_key",
        summary: "supported-currency 400 — missing api_key",
        metadata: { request_in: redactGatewayBody(body), http_status: 400 },
      });
      res.status(400).json({ error: "api_key is required" });
      return;
    }

    const gwEnvHint = parseGatewayEnvironmentFromBody(body);
    const resolved = await resolveMerchantByGatewayApiKey(apiKey, {
      gatewayEnvironment: gwEnvHint,
    });
    if (!resolved) {
      auditGatewayApi(req, {
        action: "supported_currency",
        merchantId: null,
        actorType: "gateway_api_key",
        summary: "supported-currency 401 — invalid_api_key",
        metadata: { request_in: redactGatewayBody(body), http_status: 401 },
      });
      res.status(401).json({ error: "invalid_api_key" });
      return;
    }
    const { merchant, keyType } = resolved;
    const gate = assertMerchantGatewayKeyAllowed(merchant, keyType);
    if (!gate.ok) {
      auditGatewayApi(req, {
        action: "supported_currency",
        merchantId: merchant.id,
        actorType: "gateway_api_key",
        summary: `supported-currency 403 — ${gate.error}`,
        metadata: { request_in: redactGatewayBody(body), http_status: 403 },
      });
      res.status(403).json({ error: gate.error, message: gate.message });
      return;
    }

    const pairs = listMerchantSupportedCurrencyPairs(merchant);
    const gwEnv = gatewayEnvironmentFromKeyType(keyType);
    const defaultPair = env.gatewayTronUsdtOnly ? pairs[0] : null;
    const defaultCurrencyOut = defaultPair
      ? defaultPair.currency
      : normalizeAssetPart(merchant.defaultCurrency);
    const defaultNetworkOut = defaultPair
      ? defaultPair.network
      : normalizeAssetPart(merchant.defaultNetwork);
    auditGatewayApi(req, {
      action: "supported_currency",
      merchantId: merchant.id,
      actorType: "gateway_api_key",
      summary: `supported-currency 200 · ${pairs.length} pair(s) · env=${gwEnv}`,
      metadata: {
        request_in: redactGatewayBody(body),
        response_out: {
          status: 200,
          pairs_count: pairs.length,
          gateway_environment: gwEnv,
          default_currency: defaultCurrencyOut,
          default_network: defaultNetworkOut,
        },
        occurred_at_iso: new Date().toISOString(),
      },
    });
    res.status(200).json({
      pairs,
      default_currency: defaultCurrencyOut,
      default_network: defaultNetworkOut,
      gateway_environment: gwEnv,
    });
  } catch (e) {
    logger.error("gateway supported-currency failed", { err: String(e) });
    auditGatewayApi(req, {
      action: "supported_currency",
      merchantId: null,
      actorType: "gateway_api_key",
      summary: "supported-currency 500",
      metadata: {
        request_in: redactGatewayBody(req.body ?? {}),
        http_status: 500,
        error: String(e).slice(0, 500),
      },
    });
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
      auditGatewayApi(req, {
        action: "create_wallet",
        merchantId: null,
        actorType: "gateway_api_key",
        summary: "create-wallet 400 — missing fields",
        metadata: { request_in: redactGatewayBody(body), http_status: 400 },
      });
      res
        .status(400)
        .json({ error: "api_key, user_id, currency and network are required" });
      return;
    }

    const rail = resolveDepositRail(currency, network);
    if (!rail) {
      auditGatewayApi(req, {
        action: "create_wallet",
        merchantId: null,
        actorType: "gateway_api_key",
        summary: `create-wallet 400 — unsupported ${currency}/${network}`,
        metadata: {
          request_in: redactGatewayBody(body),
          http_status: 400,
          user_id: userId,
        },
      });
      res.status(400).json({ error: "unsupported_currency_network" });
      return;
    }

    const gwEnvHint = parseGatewayEnvironmentFromBody(body);
    const resolved = await resolveMerchantByGatewayApiKey(apiKey, {
      gatewayEnvironment: gwEnvHint,
    });
    if (!resolved) {
      auditGatewayApi(req, {
        action: "create_wallet",
        merchantId: null,
        actorType: "gateway_api_key",
        summary: "create-wallet 401 — invalid_api_key",
        metadata: {
          request_in: redactGatewayBody(body),
          http_status: 401,
          user_id: userId,
        },
      });
      res.status(401).json({ error: "invalid_api_key" });
      return;
    }
    const { merchant, keyType } = resolved;
    const gate = assertMerchantGatewayKeyAllowed(merchant, keyType);
    if (!gate.ok) {
      auditGatewayApi(req, {
        action: "create_wallet",
        merchantId: merchant.id,
        actorType: "gateway_api_key",
        summary: `create-wallet 403 — ${gate.error}`,
        metadata: {
          request_in: redactGatewayBody(body),
          http_status: 403,
          user_id: userId,
        },
      });
      res.status(403).json({ error: gate.error, message: gate.message });
      return;
    }
    const gwEnv = gatewayEnvironmentFromKeyType(keyType);
    if (!merchantChainAllowsRail(merchant, rail)) {
      auditGatewayApi(req, {
        action: "create_wallet",
        merchantId: merchant.id,
        actorType: "gateway_api_key",
        summary: "create-wallet 403 — rail_not_enabled",
        metadata: {
          request_in: redactGatewayBody(body),
          http_status: 403,
          user_id: userId,
        },
      });
      res.status(403).json({ error: "rail_not_enabled_for_merchant" });
      return;
    }

    const wallet = await prisma.$transaction(async (tx) => {
      const u = await tx.user.findFirst({
        where: { id: userId, merchantId: merchant.id, environment: gwEnv },
      });
      if (!u) return null;
      return createOrGetWallet(
        u.id,
        rail.chain,
        rail.currency,
        rail.network,
        tx,
      );
    });
    if (!wallet) {
      auditGatewayApi(req, {
        action: "create_wallet",
        merchantId: merchant.id,
        actorType: "gateway_api_key",
        summary: "create-wallet 404 — user not found",
        metadata: {
          request_in: redactGatewayBody(body),
          http_status: 404,
          user_id: userId,
        },
      });
      res.status(404).json({ error: "user not found" });
      return;
    }
    auditGatewayApi(req, {
      action: "create_wallet",
      merchantId: merchant.id,
      actorType: "gateway_api_key",
      summary: `create-wallet 200 · user=${userId.slice(0, 8)}… · ${wallet.chain} ${wallet.currency}/${wallet.network}`,
      metadata: {
        request_in: redactGatewayBody(body),
        response_out: {
          status: 200,
          wallet_id: wallet.id,
          gateway_environment: gwEnv,
          chain: wallet.chain,
          currency: wallet.currency,
          network: wallet.network,
          address_preview: `${String(wallet.address).slice(0, 14)}…`,
        },
        occurred_at_iso: new Date().toISOString(),
      },
    });
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
      auditGatewayApi(req, {
        action: "create_wallet",
        merchantId: null,
        actorType: "gateway_api_key",
        summary: "create-wallet 404 — USER_NOT_FOUND",
        metadata: {
          request_in: redactGatewayBody(req.body ?? {}),
          http_status: 404,
        },
      });
      res.status(404).json({ error: "user not found" });
      return;
    }
    logger.error("gateway create-wallet failed", { err: msg });
    auditGatewayApi(req, {
      action: "create_wallet",
      merchantId: null,
      actorType: "gateway_api_key",
      summary: "create-wallet 500",
      metadata: {
        request_in: redactGatewayBody(req.body ?? {}),
        http_status: 500,
        error: msg.slice(0, 500),
      },
    });
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
      auditGatewayApi(req, {
        action: "simulate_deposit",
        merchantId: null,
        actorType: "gateway_api_key",
        summary: "simulate-deposit 400 — missing fields",
        metadata: { request_in: redactGatewayBody(body), http_status: 400 },
      });
      res.status(400).json({ error: "api_key and wallet_id are required" });
      return;
    }

    const resolved = await resolveMerchantByGatewayApiKey(apiKey, {
      gatewayEnvironment: "sandbox",
    });
    if (!resolved) {
      auditGatewayApi(req, {
        action: "simulate_deposit",
        merchantId: null,
        actorType: "gateway_api_key",
        summary: "simulate-deposit 401 — invalid_api_key",
        metadata: {
          request_in: redactGatewayBody(body),
          http_status: 401,
          wallet_id: walletId,
        },
      });
      res.status(401).json({ error: "invalid_api_key" });
      return;
    }
    const { merchant, keyType } = resolved;
    if (keyType !== "sandbox" && !env.gatewaySandbox) {
      auditGatewayApi(req, {
        action: "simulate_deposit",
        merchantId: merchant.id,
        actorType: "gateway_api_key",
        summary: "simulate-deposit 403 — sandbox_api_key_required",
        metadata: {
          request_in: redactGatewayBody(body),
          http_status: 403,
          wallet_id: walletId,
        },
      });
      res.status(403).json({
        error: "sandbox_api_key_required",
        message:
          "simulate-deposit only runs against sandbox data. If your account still uses a separate live-only secret, use the sandbox secret. Or set GATEWAY_SANDBOX=true for local development.",
      });
      return;
    }
    const gate = assertMerchantGatewayKeyAllowed(merchant, "sandbox");
    if (!gate.ok) {
      auditGatewayApi(req, {
        action: "simulate_deposit",
        merchantId: merchant.id,
        actorType: "gateway_api_key",
        summary: `simulate-deposit 403 — ${gate.error}`,
        metadata: {
          request_in: redactGatewayBody(body),
          http_status: 403,
          wallet_id: walletId,
        },
      });
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
    auditGatewayApi(req, {
      action: "simulate_deposit",
      merchantId: merchant.id,
      actorType: "gateway_api_key",
      summary: `simulate-deposit 200 · tx=${String(out.tx_hash ?? "").slice(0, 16)}…`,
      metadata: {
        request_in: redactGatewayBody(body),
        response_out: {
          status: 200,
          transaction_id: out.transaction_id,
          tx_hash: out.tx_hash,
          wallet_id: walletId,
          amount: out.amount,
          token_symbol: out.token_symbol,
        },
        occurred_at_iso: new Date().toISOString(),
      },
    });
    res.status(200).json(out);
  } catch (e) {
    if (/** @type {any} */ (e).code === "WALLET_NOT_FOUND") {
      auditGatewayApi(req, {
        action: "simulate_deposit",
        merchantId: null,
        actorType: "gateway_api_key",
        summary: "simulate-deposit 404 — wallet_not_found",
        metadata: {
          request_in: redactGatewayBody(req.body ?? {}),
          http_status: 404,
        },
      });
      res.status(404).json({ error: "wallet_not_found" });
      return;
    }
    logger.error("gateway sandbox simulate-deposit failed", { err: String(e) });
    auditGatewayApi(req, {
      action: "simulate_deposit",
      merchantId: null,
      actorType: "gateway_api_key",
      summary: "simulate-deposit 500",
      metadata: {
        request_in: redactGatewayBody(req.body ?? {}),
        http_status: 500,
        error: String(e).slice(0, 500),
      },
    });
    res.status(500).json({ error: "internal error" });
  }
});

export { router as gatewayRouter };
