import { Router } from "express";
import { Chain, TxStatus } from "@prisma/client";
import { prismaClientKnowsTxStatusUnderpaid } from "../lib/prisma-tx-status.js";
import {
  findGatewayBlockingPendingCallbackRaw,
  findGatewayPollUnderpaidRowRaw,
} from "../lib/underpaid-prisma-raw.js";
import { formatAtomicAmountString } from "../lib/format-atomic-amount.js";
import {
  parseOptionalGatewayDepositAmount,
  tokenDecimalsForGatewayRail,
} from "../lib/gateway-expected-amount.js";
import { prisma } from "../lib/prisma.js";
import { ACTIVE } from "../lib/active-row.js";
import { env } from "../config/env.js";
import { re } from "../config/runtime-env.js";
import { assignPooledWalletForDeposit } from "../services/wallet/wallet-service.js";
import { logger } from "../lib/logger.js";
import {
  authenticateGatewayJsonPost,
  authenticateGatewaySupportedCurrencyGet,
} from "../lib/gateway-request-auth.js";
import { simulateSandboxDeposit } from "../services/payment/sandbox-deposit.js";
import {
  assertMerchantGatewayKeyAllowed,
  gatewayEnvironmentFromKeyType,
} from "../lib/merchant-gateway-env.js";
import {
  listMerchantSupportedCurrencyPairs,
  merchantChainAllowsRail,
  normalizeAssetPart,
  railNotEnabledForMerchantMessage,
  resolveDepositRail,
} from "../config/payment-rails.js";
import { isChainLiveForPlatform } from "../lib/chain-enable.js";
import {
  redactGatewayBody,
  requestClientIp,
  writeAuditLog,
} from "../services/audit-log.js";
import { createPaymentLinkToken, verifyPaymentLinkToken } from "../lib/payment-link-token.js";
import { normalizeGatewayRedirectUrl } from "../lib/payment-redirect-url.js";
import { walletScanTtlMinutes } from "../lib/wallet-scan.js";
import {
  resolveUserScopedInternalId,
  resolveWalletInternalId,
} from "../lib/entity-internal-id.js";
import { MAX_AUTO_CALLBACK_ATTEMPTS } from "../services/callback-service.js";

const router = Router();

/** @type {ReadonlySet<string>} */
const CHAIN_QUERY_VALUES = new Set(Object.values(Chain));

const MAX_GATEWAY_TRANSACTION_REF_LEN = 256;

/**
 * Optional merchant checkout / order id (`transaction_id` in gateway JSON).
 * @param {unknown} raw
 * @returns {{ ok: true, value: string | null } | { ok: false, error: string }}
 */
function parseOptionalGatewayTransactionId(raw) {
  if (raw == null || raw === "") return { ok: true, value: null };
  const s = String(raw).trim();
  if (!s) return { ok: true, value: null };
  if (s.length > MAX_GATEWAY_TRANSACTION_REF_LEN) {
    return { ok: false, error: "transaction_id_too_long" };
  }
  return { ok: true, value: s };
}

function paymentPageBaseUrl() {
  const raw = re.paymentPagePublicUrl.trim() || re.appPublicUrl;
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

/**
 * Lightweight poll for the checkout page: same wallet as the payment link token,
 * no address/currency query params (avoids client/server mismatch vs `/transactions`).
 */
router.get("/api/v1/gateway/payment-session/:token/poll", async (req, res) => {
  try {
    const rawToken =
      typeof req.params.token === "string" ? req.params.token.trim() : "";
    const v = verifyPaymentLinkToken(rawToken);
    if (!v) {
      res.status(410).json({ error: "payment_link_invalid_or_expired" });
      return;
    }
    const wid = await resolveWalletInternalId(String(v.walletId ?? ""));
    if (wid == null) {
      res.status(410).json({ error: "payment_link_invalid_or_expired" });
      return;
    }
    const w = await prisma.wallet.findFirst({
      where: { id: wid, ...ACTIVE },
      select: { id: true },
    });
    if (!w) {
      res.status(410).json({ error: "payment_link_invalid_or_expired" });
      return;
    }
    let successRow = null;
    let underpaidRow = null;
    if (v.depositSessionKey) {
      successRow = await prisma.transaction.findFirst({
        where: {
          walletId: wid,
          status: TxStatus.success,
          depositSessionKey: v.depositSessionKey,
          ...ACTIVE,
        },
        select: { id: true },
      });
      underpaidRow = prismaClientKnowsTxStatusUnderpaid()
        ? await prisma.transaction.findFirst({
            where: {
              walletId: wid,
              status: TxStatus.underpaid,
              depositSessionKey: v.depositSessionKey,
              ...ACTIVE,
            },
            select: { id: true },
          })
        : await findGatewayPollUnderpaidRowRaw(prisma, {
            walletId: wid,
            depositSessionKey: v.depositSessionKey,
          });
    } else {
      const since =
        v.linkIssuedAt != null ? new Date(v.linkIssuedAt * 1000) : null;
      successRow = await prisma.transaction.findFirst({
        where: {
          walletId: wid,
          status: TxStatus.success,
          ...ACTIVE,
          ...(since ? { updatedAt: { gte: since } } : {}),
        },
        select: { id: true },
      });
    }
    res.json({
      has_successful_deposit: Boolean(successRow),
      has_underpaid_deposit: Boolean(underpaidRow),
    });
  } catch (e) {
    logger.error("gateway payment-session poll failed", { err: String(e) });
    res.status(500).json({ error: "internal error" });
  }
});

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
    const wid = await resolveWalletInternalId(String(v.walletId ?? ""));
    if (wid == null) {
      res.status(410).json({ error: "payment_link_invalid_or_expired" });
      return;
    }
    const w = await prisma.wallet.findFirst({
      where: { id: wid, ...ACTIVE },
      select: {
        address: true,
        chain: true,
        currency: true,
        network: true,
        scanExpiresAt: true,
        holdExpiresAt: true,
      },
    });
    if (!w) {
      res.status(410).json({ error: "payment_link_invalid_or_expired" });
      return;
    }
    let expected_amount_atomic = null;
    let expected_amount_decimal = null;
    if (v.depositSessionKey) {
      const ev = await prisma.walletAssignmentEvent.findFirst({
        where: {
          walletId: wid,
          depositSessionKey: v.depositSessionKey,
          ...ACTIVE,
        },
        select: { expectedAmountAtomic: true },
      });
      const raw = ev?.expectedAmountAtomic?.trim();
      if (raw && /^\d+$/.test(raw)) {
        const dec = tokenDecimalsForGatewayRail(w.currency, w.network);
        if (dec != null) {
          expected_amount_atomic = raw;
          expected_amount_decimal = formatAtomicAmountString(raw, dec);
        }
      }
    }
    res.json({
      address: w.address,
      chain: w.chain,
      currency: w.currency,
      network: w.network,
      deposit_scan_expires_at: w.scanExpiresAt?.toISOString() ?? null,
      deposit_scan_ttl_minutes: walletScanTtlMinutes(),
      reservation_expires_at: w.holdExpiresAt?.toISOString() ?? null,
      redirect_url: redirectUrl,
      ...(expected_amount_atomic != null
        ? {
            expected_amount_atomic,
            expected_amount_decimal,
          }
        : {}),
    });
  } catch (e) {
    logger.error("gateway payment-session failed", { err: String(e) });
    res.status(500).json({ error: "internal error" });
  }
});

router.post("/api/v1/gateway/deposit-address", async (req, res) => {
  try {
    const body = req.body ?? {};
    const auth = await authenticateGatewayJsonPost(req);
    if (!auth.ok) {
      auditGatewayApi(req, {
        action: "deposit_address",
        merchantId: null,
        actorType: "gateway_api_key",
        summary: `deposit-address ${auth.status} — ${auth.error}`,
        metadata: { request_in: redactGatewayBody(body), http_status: auth.status },
      });
      res
        .status(auth.status)
        .json(
          auth.message
            ? { error: auth.error, message: auth.message }
            : { error: auth.error },
        );
      return;
    }
    const { merchant, keyType } = auth;
    const externalUserId = body.external_user_id?.trim();
    if (!externalUserId) {
      auditGatewayApi(req, {
        action: "deposit_address",
        merchantId: merchant.id,
        actorType: "gateway_api_key",
        summary: "deposit-address 400 — missing external_user_id",
        metadata: { request_in: redactGatewayBody(body), http_status: 400 },
      });
      res.status(400).json({ error: "external_user_id is required" });
      return;
    }
    const txRefParsed = parseOptionalGatewayTransactionId(body.transaction_id);
    if (!txRefParsed.ok) {
      auditGatewayApi(req, {
        action: "deposit_address",
        merchantId: merchant.id,
        actorType: "gateway_api_key",
        summary: `deposit-address 400 — ${txRefParsed.error}`,
        metadata: { request_in: redactGatewayBody(body), http_status: 400 },
      });
      res.status(400).json({ error: txRefParsed.error });
      return;
    }
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
    if (re.gatewayTronUsdtOnly && !bodySpecifiedCurrencyNetwork) {
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
      res.status(403).json({
        error: "rail_not_enabled_for_merchant",
        message: railNotEnabledForMerchantMessage(merchant, rail),
      });
      return;
    }
    if (!isChainLiveForPlatform(re.chainEnabledRecord, rail.chain)) {
      auditGatewayApi(req, {
        action: "deposit_address",
        merchantId: merchant.id,
        actorType: "gateway_api_key",
        summary: "deposit-address 403 — chain_disabled_for_platform",
        metadata: {
          request_in: redactGatewayBody(body),
          http_status: 403,
          external_user_id: externalUserId,
          chain: rail.chain,
        },
      });
      res.status(403).json({
        error: "chain_disabled_for_platform",
        message: `Chain ${rail.chain} is disabled by the operator (admin → Supported chains).`,
      });
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

    const tokenDecimals = tokenDecimalsForGatewayRail(currency, network);
    let expectedAmountAtomic = null;
    if (body.amount != null && String(body.amount).trim()) {
      if (tokenDecimals == null) {
        auditGatewayApi(req, {
          action: "deposit_address",
          merchantId: merchant.id,
          actorType: "gateway_api_key",
          summary: "deposit-address 400 — amount_not_supported_for_rail",
          metadata: {
            request_in: redactGatewayBody(body),
            http_status: 400,
            external_user_id: externalUserId,
            currency,
            network,
          },
        });
        res.status(400).json({ error: "amount_not_supported_for_rail" });
        return;
      }
      const parsed = parseOptionalGatewayDepositAmount(body.amount, tokenDecimals);
      if (!parsed.ok) {
        auditGatewayApi(req, {
          action: "deposit_address",
          merchantId: merchant.id,
          actorType: "gateway_api_key",
          summary: `deposit-address 400 — ${parsed.error}`,
          metadata: {
            request_in: redactGatewayBody(body),
            http_status: 400,
            external_user_id: externalUserId,
          },
        });
        res.status(400).json({ error: parsed.error });
        return;
      }
      expectedAmountAtomic = parsed.atomic;
    }

    let u = await prisma.user.findFirst({
      where: {
        merchantId: merchant.id,
        externalUserId,
        environment: gwEnv,
        ...ACTIVE,
      },
    });
    let createdNewUser = false;
    if (!u) {
      u = await prisma.user.create({
        data: {
          merchantId: merchant.id,
          externalUserId,
          environment: gwEnv,
        },
      });
      createdNewUser = true;
    }

    if (String(merchant.callbackUrl ?? "").trim()) {
      const blocking = prismaClientKnowsTxStatusUnderpaid()
        ? await prisma.transaction.findFirst({
            where: {
              status: { in: [TxStatus.success, TxStatus.underpaid, TxStatus.failed] },
              callbackDeliveredAt: null,
              /** After max auto attempts, allow new deposit addresses; merchant can fix webhook and resend later. */
              callbackAttemptCount: { lt: MAX_AUTO_CALLBACK_ATTEMPTS },
              payerUserId: u.id,
              ...ACTIVE,
              wallet: { merchantId: merchant.id, environment: gwEnv, ...ACTIVE },
            },
            select: { id: true },
          })
        : await findGatewayBlockingPendingCallbackRaw(prisma, {
            payerUserId: u.id,
            merchantId: merchant.id,
            gwEnv,
            maxAttempts: MAX_AUTO_CALLBACK_ATTEMPTS,
          });
      if (blocking) {
        auditGatewayApi(req, {
          action: "deposit_address",
          merchantId: merchant.id,
          actorType: "gateway_api_key",
          summary: "deposit-address 409 — callback_pending",
          metadata: {
            request_in: redactGatewayBody(body),
            http_status: 409,
            external_user_id: externalUserId,
          },
        });
        res.status(409).json({
          error: "callback_pending",
          message: `A payment webhook (X-Webhook-Event: payment; check JSON status: success, underpaid, or failed) was not delivered with a 2xx response. New deposit addresses are blocked until delivery succeeds or automatic retries finish (up to ${MAX_AUTO_CALLBACK_ATTEMPTS} attempts, at most one per minute). After retries are exhausted, you may request a new address; fix your callback URL/handler and resend from the merchant portal (transaction detail) for the affected payment.`,
        });
        return;
      }
    }

    const { wallet, depositSessionKey } = await prisma.$transaction(async (tx) => {
      const assigned = await assignPooledWalletForDeposit(tx, {
        merchantId: merchant.id,
        environment: gwEnv,
        userId: u.id,
        chain: rail.chain,
        currency: rail.currency,
        network: rail.network,
        referenceTransactionId: txRefParsed.value,
        expectedAmountAtomic,
      });
      return {
        wallet: assigned.wallet,
        depositSessionKey: assigned.depositSessionKey,
      };
    });
    const responseOut = {
      status: 200,
      wallet_id: wallet.id,
      user_id: u.id,
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
      summary: `deposit-address 200 · ext=${externalUserId} · ${wallet.chain} ${wallet.currency}/${wallet.network} · new_user=${createdNewUser} · user=${u.id}`,
      metadata: {
        request_in: redactGatewayBody(body),
        response_out: {
          ...responseOut,
          payment_link: true,
        },
        occurred_at_iso: new Date().toISOString(),
      },
    });
    const payToken = createPaymentLinkToken(
      String(wallet.id),
      redirectUrl,
      depositSessionKey,
    );
    const payBase = paymentPageBaseUrl();
    res.status(200).json({
      address: wallet.address,
      chain: wallet.chain,
      currency: wallet.currency,
      network: wallet.network,
      wallet_id: wallet.id,
      user_id: u.id,
      merchant_id: merchant.id,
      created_new_user: createdNewUser,
      gateway_environment: gwEnv,
      payment_link: `${payBase}/pay/${payToken}`,
      deposit_scan_expires_at: wallet.scanExpiresAt?.toISOString() ?? null,
      deposit_scan_ttl_minutes: walletScanTtlMinutes(),
      reservation_expires_at: wallet.holdExpiresAt?.toISOString() ?? null,
      redirect_url: redirectUrl,
      ...(expectedAmountAtomic != null && tokenDecimals != null
        ? {
            expected_amount_atomic: expectedAmountAtomic,
            expected_amount_decimal: formatAtomicAmountString(
              expectedAmountAtomic,
              tokenDecimals,
            ),
          }
        : {}),
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
    res.status(500).json(
      env.nodeEnv === "development"
        ? { error: "internal error", message: String(e).slice(0, 500) }
        : { error: "internal error" },
    );
  }
});

/**
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {() => Promise<{ ok: true, merchant: import("@prisma/client").Merchant, keyType: "live" | "sandbox" } | { ok: false, status: number, error: string, message?: string }>} authFn
 */
async function handleSupportedCurrency(req, res, authFn) {
  try {
    const body = req.body ?? {};
    const auth = await authFn();
    const requestInMeta =
      req.method === "GET"
        ? { query: req.query ?? {}, auth: "x_token_api_key_envelope" }
        : redactGatewayBody(body);
    if (!auth.ok) {
      auditGatewayApi(req, {
        action: "supported_currency",
        merchantId: null,
        actorType: "gateway_api_key",
        summary: `supported-currency ${req.method} ${auth.status} — ${auth.error}`,
        metadata: { request_in: requestInMeta, http_status: auth.status },
      });
      res
        .status(auth.status)
        .json(
          auth.message
            ? { error: auth.error, message: auth.message }
            : { error: auth.error },
        );
      return;
    }
    const { merchant, keyType } = auth;
    const gate = assertMerchantGatewayKeyAllowed(merchant, keyType);
    if (!gate.ok) {
      auditGatewayApi(req, {
        action: "supported_currency",
        merchantId: merchant.id,
        actorType: "gateway_api_key",
        summary: `supported-currency ${req.method} 403 — ${gate.error}`,
        metadata: { request_in: requestInMeta, http_status: 403 },
      });
      res.status(403).json({ error: gate.error, message: gate.message });
      return;
    }

    const pairs = listMerchantSupportedCurrencyPairs(merchant);
    const gwEnv = gatewayEnvironmentFromKeyType(keyType);
    const defaultPair = re.gatewayTronUsdtOnly ? pairs[0] : null;
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
      summary: `supported-currency ${req.method} 200 · ${pairs.length} pair(s) · env=${gwEnv}`,
      metadata: {
        request_in: requestInMeta,
        response_out: {
          status: 200,
          pairs_count: pairs.length,
          gateway_environment: gwEnv,
          gateway_tron_usdt_only: re.gatewayTronUsdtOnly,
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
      gateway_tron_usdt_only: re.gatewayTronUsdtOnly,
    });
  } catch (e) {
    logger.error("gateway supported-currency failed", { err: String(e) });
    auditGatewayApi(req, {
      action: "supported_currency",
      merchantId: null,
      actorType: "gateway_api_key",
      summary: `supported-currency ${req.method} 500`,
      metadata: {
        request_in:
          req.method === "GET"
            ? { query: req.query ?? {} }
            : redactGatewayBody(req.body ?? {}),
        http_status: 500,
        error: String(e).slice(0, 500),
      },
    });
    res.status(500).json({ error: "internal error" });
  }
}

router.get("/api/v1/gateway/supported-currency", async (req, res) => {
  await handleSupportedCurrency(req, res, () =>
    authenticateGatewaySupportedCurrencyGet(req),
  );
});

router.post("/api/v1/gateway/supported-currency", async (req, res) => {
  await handleSupportedCurrency(req, res, () => authenticateGatewayJsonPost(req));
});

router.post("/api/v1/gateway/create-wallet", async (req, res) => {
  try {
    const body = req.body ?? {};
    const auth = await authenticateGatewayJsonPost(req);
    if (!auth.ok) {
      auditGatewayApi(req, {
        action: "create_wallet",
        merchantId: null,
        actorType: "gateway_api_key",
        summary: `create-wallet ${auth.status} — ${auth.error}`,
        metadata: { request_in: redactGatewayBody(body), http_status: auth.status },
      });
      res
        .status(auth.status)
        .json(
          auth.message
            ? { error: auth.error, message: auth.message }
            : { error: auth.error },
        );
      return;
    }
    const { merchant, keyType } = auth;
    const userId = body.user_id?.trim();
    const currency = normalizeAssetPart(body.currency);
    const network = normalizeAssetPart(body.network);
    if (!userId || !currency || !network) {
      auditGatewayApi(req, {
        action: "create_wallet",
        merchantId: merchant.id,
        actorType: "gateway_api_key",
        summary: "create-wallet 400 — missing fields",
        metadata: { request_in: redactGatewayBody(body), http_status: 400 },
      });
      res
        .status(400)
        .json({ error: "user_id, currency and network are required" });
      return;
    }

    const createWalletTxRef = parseOptionalGatewayTransactionId(
      body.transaction_id,
    );
    if (!createWalletTxRef.ok) {
      auditGatewayApi(req, {
        action: "create_wallet",
        merchantId: merchant.id,
        actorType: "gateway_api_key",
        summary: `create-wallet 400 — ${createWalletTxRef.error}`,
        metadata: { request_in: redactGatewayBody(body), http_status: 400 },
      });
      res.status(400).json({ error: createWalletTxRef.error });
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
      res.status(403).json({
        error: "rail_not_enabled_for_merchant",
        message: railNotEnabledForMerchantMessage(merchant, rail),
      });
      return;
    }
    if (!isChainLiveForPlatform(re.chainEnabledRecord, rail.chain)) {
      auditGatewayApi(req, {
        action: "create_wallet",
        merchantId: merchant.id,
        actorType: "gateway_api_key",
        summary: "create-wallet 403 — chain_disabled_for_platform",
        metadata: {
          request_in: redactGatewayBody(body),
          http_status: 403,
          user_id: userId,
          chain: rail.chain,
        },
      });
      res.status(403).json({
        error: "chain_disabled_for_platform",
        message: `Chain ${rail.chain} is disabled by the operator (admin → Supported chains).`,
      });
      return;
    }

    const assigned = await prisma.$transaction(async (tx) => {
      const uid = await resolveUserScopedInternalId(
        userId,
        merchant.id,
        gwEnv,
      );
      const u = uid
        ? await tx.user.findUnique({
            where: { id: uid },
          })
        : null;
      if (!u) return null;
      return assignPooledWalletForDeposit(tx, {
        merchantId: merchant.id,
        environment: gwEnv,
        userId: u.id,
        chain: rail.chain,
        currency: rail.currency,
        network: rail.network,
        referenceTransactionId: createWalletTxRef.value,
      });
    });
    if (!assigned) {
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
    const wallet = assigned.wallet;
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

  const chainQ =
    typeof req.query.chain === "string" ? req.query.chain.trim().toUpperCase() : "";
  const chainFilter =
    chainQ && CHAIN_QUERY_VALUES.has(chainQ)
      ? /** @type {import("@prisma/client").Chain} */ (chainQ)
      : undefined;

  const walletAddressFilter = address.startsWith("0x")
    ? { equals: address, mode: "insensitive" }
    : address;

  const txs = await prisma.transaction.findMany({
    where: {
      ...ACTIVE,
      wallet: {
        ...ACTIVE,
        address: walletAddressFilter,
        ...(chainFilter ? { chain: chainFilter } : {}),
        ...(currencyF && networkF
          ? {
              currency: { equals: currencyF, mode: "insensitive" },
              network: { equals: networkF, mode: "insensitive" },
            }
          : {}),
      },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      wallet: {
        select: {
          currency: true,
          network: true,
          environment: true,
        },
      },
    },
  });

  res.json({
    transactions: txs.map((t) => ({
      id: t.id,
      transaction_id: t.referenceTransactionId ?? null,
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
      gateway_environment: t.wallet.environment,
    })),
  });
});

router.get("/api/v1/gateway/sandbox/simulate-deposit", (req, res) => {
  res.status(405).set("Allow", "POST").json({
    error: "method_not_allowed",
    message:
      "simulate-deposit requires POST with Content-Type: application/json (wallet_id, optional amount) and gateway auth (X-Token + X-Merchant-Id). Browser address bar uses GET and will not work.",
  });
});

router.post("/api/v1/gateway/sandbox/simulate-deposit", async (req, res) => {
  try {
    const body = req.body ?? {};
    const auth = await authenticateGatewayJsonPost(req);
    if (!auth.ok) {
      auditGatewayApi(req, {
        action: "simulate_deposit",
        merchantId: null,
        actorType: "gateway_api_key",
        summary: `simulate-deposit ${auth.status} — ${auth.error}`,
        metadata: { request_in: redactGatewayBody(body), http_status: auth.status },
      });
      res
        .status(auth.status)
        .json(
          auth.message
            ? { error: auth.error, message: auth.message }
            : { error: auth.error },
        );
      return;
    }
    const { merchant, keyType } = auth;
    const walletId = body.wallet_id?.trim();
    if (!walletId) {
      auditGatewayApi(req, {
        action: "simulate_deposit",
        merchantId: merchant.id,
        actorType: "gateway_api_key",
        summary: "simulate-deposit 400 — missing wallet_id",
        metadata: { request_in: redactGatewayBody(body), http_status: 400 },
      });
      res.status(400).json({ error: "wallet_id is required" });
      return;
    }
    if (keyType !== "sandbox" && !re.gatewaySandbox) {
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
