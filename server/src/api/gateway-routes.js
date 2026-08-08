import { Router } from "express";
import { Chain, TxStatus } from "@prisma/client";
import {
  prismaClientKnowsTxStatusCreated,
  prismaClientKnowsTxStatusUnderpaid,
} from "../lib/prisma-tx-status.js";
import { findGatewayPollUnderpaidRowRaw } from "../lib/underpaid-prisma-raw.js";
import { formatAtomicAmountString } from "../lib/format-atomic-amount.js";
import {
  expectedReceivedAmountQuadForTransaction,
  loadExpectedAtomicByWalletSessionForTransactions,
  paymentWebhookAmountGroups,
} from "../lib/transaction-requested-amounts.js";
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
import { createMerchantWithdrawalRequest } from "../services/merchant-withdrawal-request.js";
import { executeAutoPayout } from "../services/payout/execute-auto-payout.js";
import { withdrawalGatewayPayoutJson } from "../lib/merchant-withdrawal-response.js";
import { fillMissingWithdrawalNetworkFees } from "../services/payout-withdrawal-network-fee.js";
import {
  effectivePayoutPolicyForRail,
  payoutRailKeyForChain,
} from "../lib/merchant-payout-rails-policy.js";
import { isChainLiveForPlatform } from "../lib/chain-enable.js";
import {
  redactGatewayBody,
  requestClientIp,
  writeAuditLog,
} from "../services/audit-log.js";
import { normalizeGatewayRedirectUrl } from "../lib/payment-redirect-url.js";
import {
  createPaymentLinkToken,
  verifyPaymentLinkToken,
} from "../lib/payment-link-token.js";
import {
  effectiveWalletAssignmentHoldMinutes,
  effectiveWalletScanTtlMinutes,
  paymentPageCheckoutFallbackMinutes,
} from "../lib/wallet-scan.js";
import { resolveWalletInternalId } from "../lib/entity-internal-id.js";
/** @type {readonly string[]} */
const DEPRECATED_GATEWAY_TRANSACTIONS_QUERY_KEYS = [
  "address",
  "reference_id",
  "reference_transaction_id",
  "currency",
  "network",
  "chain",
];

/**
 * @param {import("@prisma/client").Transaction & {
 *   payerUser?: { externalUserId: string } | null;
 *   wallet: {
 *     currency: string;
 *     network: string;
 *     environment: import("@prisma/client").MerchantGatewayEnv;
 *     assignedUser: { externalUserId: string } | null;
 *   };
 * }} t
 * @param {Awaited<ReturnType<typeof loadExpectedAtomicByWalletSessionForTransactions>>} expectedByKey
 */
function serializeGatewayTransactionForApi(t, expectedByKey) {
  const quad = expectedReceivedAmountQuadForTransaction(t, expectedByKey);
  const groups = paymentWebhookAmountGroups(quad);
  const endUserExt =
    t.payerUser?.externalUserId ??
    t.wallet.assignedUser?.externalUserId ??
    null;
  return {
    id: t.id,
    transaction_id: t.referenceTransactionId ?? null,
    reference_id: t.referenceTransactionId ?? null,
    wallet_id: t.walletId,
    external_user_id: endUserExt,
    deposit_session_key: t.depositSessionKey ?? null,
    tx_hash: t.txHash,
    from_address: t.fromAddress,
    to_address: t.toAddress,
    amount: quad.received_amount_atomic,
    amount_decimal: quad.received_amount_decimal,
    ...quad,
    ...groups,
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
  };
}

const router = Router();

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

function paymentPageBaseUrl() {
  const raw = re.paymentPagePublicUrl.trim() || re.appPublicUrl;
  return String(raw).replace(/\/+$/, "");
}

/**
 * Lightweight poll for hosted checkout: token-scoped wallet + session.
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
        environment: true,
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
    /** @type {{ expectedAmountAtomic: string | null, createdAt: Date } | null} */
    let assignmentForSession = null;
    if (v.depositSessionKey) {
      assignmentForSession = await prisma.walletAssignmentEvent.findFirst({
        where: {
          walletId: wid,
          depositSessionKey: v.depositSessionKey,
          ...ACTIVE,
        },
        select: { expectedAmountAtomic: true, createdAt: true },
      });
      const raw = assignmentForSession?.expectedAmountAtomic?.trim();
      if (raw && /^\d+$/.test(raw)) {
        const dec = tokenDecimalsForGatewayRail(w.currency, w.network);
        if (dec != null) {
          expected_amount_atomic = raw;
          expected_amount_decimal = formatAtomicAmountString(raw, dec);
        }
      }
    }

    /**
     * Stable clock anchor for scan/hold/checkout JSON when `wallets.scan_expires_at` / `hold_expires_at`
     * are null — prefer assignment event, else earliest `gateway-created:` tx for this session.
     */
    let sessionAnchorAt = assignmentForSession?.createdAt ?? null;
    if (!sessionAnchorAt && v.depositSessionKey) {
      const anchorTx = await prisma.transaction.findFirst({
        where: {
          walletId: wid,
          depositSessionKey: v.depositSessionKey,
          txHash: { startsWith: "gateway-created:" },
          ...ACTIVE,
        },
        select: { createdAt: true },
        orderBy: { id: "asc" },
      });
      sessionAnchorAt = anchorTx?.createdAt ?? null;
    }

    /** When scan/hold TTLs are disabled (null DB timestamps), still expose an unpaid-checkout deadline. */
    let checkout_expires_at = null;
    if (v.depositSessionKey && prismaClientKnowsTxStatusCreated()) {
      const ph = await prisma.transaction.findFirst({
        where: {
          walletId: wid,
          depositSessionKey: v.depositSessionKey,
          status: TxStatus.created,
          txHash: { startsWith: "gateway-created:" },
          ...ACTIVE,
        },
        select: { createdAt: true },
        orderBy: { id: "desc" },
      });
      if (ph?.createdAt) {
        const hours = Math.max(1, re.checkoutCreatedExpiryHours);
        checkout_expires_at = new Date(
          ph.createdAt.getTime() + hours * 60 * 60 * 1000,
        ).toISOString();
      }
    }
    if (!checkout_expires_at) {
      if (sessionAnchorAt) {
        checkout_expires_at = new Date(
          sessionAnchorAt.getTime() +
            paymentPageCheckoutFallbackMinutes * 60 * 1000,
        ).toISOString();
      } else {
        checkout_expires_at = new Date(
          Date.now() + paymentPageCheckoutFallbackMinutes * 60 * 1000,
        ).toISOString();
      }
    }

    let deposit_scan_expires_at = w.scanExpiresAt?.toISOString() ?? null;
    if (!deposit_scan_expires_at) {
      const scanTtlMin = re.walletScanTtlMinutes;
      if (scanTtlMin > 0 && sessionAnchorAt) {
        deposit_scan_expires_at = new Date(
          sessionAnchorAt.getTime() + scanTtlMin * 60 * 1000,
        ).toISOString();
      } else if (scanTtlMin > 0) {
        deposit_scan_expires_at = new Date(
          Date.now() + effectiveWalletScanTtlMinutes() * 60 * 1000,
        ).toISOString();
      }
    }
    let reservation_expires_at = w.holdExpiresAt?.toISOString() ?? null;
    if (!reservation_expires_at) {
      const holdMin = re.walletAssignmentHoldMinutes;
      if (holdMin > 0 && sessionAnchorAt) {
        reservation_expires_at = new Date(
          sessionAnchorAt.getTime() + holdMin * 60 * 1000,
        ).toISOString();
      } else if (holdMin > 0) {
        reservation_expires_at = new Date(
          Date.now() + effectiveWalletAssignmentHoldMinutes() * 60 * 1000,
        ).toISOString();
      }
    }

    res.json({
      address: w.address,
      chain: w.chain,
      currency: w.currency,
      network: w.network,
      gateway_environment: w.environment,
      deposit_scan_expires_at,
      deposit_scan_ttl_minutes: effectiveWalletScanTtlMinutes(),
      reservation_expires_at,
      checkout_expires_at,
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

    const cooldownSec = re.gatewayDepositAddressCooldownSec;
    if (cooldownSec > 0 && u.lastGatewayDepositAddressAt) {
      const elapsedMs = Date.now() - u.lastGatewayDepositAddressAt.getTime();
      const cooldownMs = cooldownSec * 1000;
      if (elapsedMs < cooldownMs) {
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((cooldownMs - elapsedMs) / 1000),
        );
        auditGatewayApi(req, {
          action: "deposit_address",
          merchantId: merchant.id,
          actorType: "gateway_api_key",
          summary: `deposit-address 429 — deposit_address_cooldown · retry_after=${retryAfterSeconds}s`,
          metadata: {
            request_in: redactGatewayBody(body),
            http_status: 429,
            external_user_id: externalUserId,
            retry_after_seconds: retryAfterSeconds,
          },
        });
        res.status(429).json({
          error: "deposit_address_cooldown",
          message: `Another deposit address can be requested after ${retryAfterSeconds} second(s).`,
          retry_after_seconds: retryAfterSeconds,
        });
        return;
      }
    }

    const { wallet, depositSessionKey, referenceTransactionId } =
      await prisma.$transaction(async (tx) => {
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
        await tx.user.update({
          where: { id: u.id },
          data: { lastGatewayDepositAddressAt: new Date() },
        });
        return {
          wallet: assigned.wallet,
          depositSessionKey: assigned.depositSessionKey,
          referenceTransactionId: assigned.referenceTransactionId,
        };
      });

    let checkout_expires_at =
      prismaClientKnowsTxStatusCreated() && depositSessionKey
        ? new Date(
            Date.now() +
              Math.max(1, re.checkoutCreatedExpiryHours) * 60 * 60 * 1000,
          ).toISOString()
        : null;
    if (!checkout_expires_at) {
      checkout_expires_at = new Date(
        Date.now() + paymentPageCheckoutFallbackMinutes * 60 * 1000,
      ).toISOString();
    }
    let deposit_scan_expires_at = wallet.scanExpiresAt?.toISOString() ?? null;
    if (!deposit_scan_expires_at) {
      deposit_scan_expires_at = new Date(
        Date.now() + effectiveWalletScanTtlMinutes() * 60 * 1000,
      ).toISOString();
    }
    let reservation_expires_at = wallet.holdExpiresAt?.toISOString() ?? null;
    if (!reservation_expires_at) {
      reservation_expires_at = new Date(
        Date.now() + effectiveWalletAssignmentHoldMinutes() * 60 * 1000,
      ).toISOString();
    }
    const responseOut = {
      status: 200,
      wallet_id: wallet.id,
      user_id: u.id,
      merchant_id: merchant.id,
      created_new_user: createdNewUser,
      gateway_environment: gwEnv,
      transaction_id: referenceTransactionId,
      reference_id: referenceTransactionId,
      chain: wallet.chain,
      currency: wallet.currency,
      network: wallet.network,
      address_preview: `${String(wallet.address).slice(0, 14)}…`,
    };
    const payBase = paymentPageBaseUrl();
    const payToken = createPaymentLinkToken(
      String(wallet.id),
      redirectUrl,
      depositSessionKey,
    );
    const payment_link =
      payBase && payToken ? `${payBase}/pay/${payToken}` : null;
    auditGatewayApi(req, {
      action: "deposit_address",
      merchantId: merchant.id,
      actorType: "gateway_api_key",
      summary: `deposit-address 200 · ext=${externalUserId} · ${wallet.chain} ${wallet.currency}/${wallet.network} · new_user=${createdNewUser} · user=${u.id}`,
      metadata: {
        request_in: redactGatewayBody(body),
        response_out: { ...responseOut, payment_link: Boolean(payment_link) },
        occurred_at_iso: new Date().toISOString(),
      },
    });
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
      transaction_id: referenceTransactionId,
      reference_id: referenceTransactionId,
      ...(payment_link ? { payment_link } : {}),
      deposit_scan_expires_at,
      deposit_scan_ttl_minutes: effectiveWalletScanTtlMinutes(),
      reservation_expires_at,
      checkout_expires_at,
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

router.get("/api/v1/gateway/transactions", async (req, res) => {
  try {
    const auth = await authenticateGatewaySupportedCurrencyGet(req);
    if (!auth.ok) {
      auditGatewayApi(req, {
        action: "gateway_transactions_get",
        merchantId: null,
        actorType: "gateway_api_key",
        summary: `transactions GET ${auth.status} — ${auth.error}`,
        metadata: { query: req.query ?? {}, http_status: auth.status },
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
        action: "gateway_transactions_get",
        merchantId: merchant.id,
        actorType: "gateway_api_key",
        summary: `transactions GET 403 — ${gate.error}`,
        metadata: { query: req.query ?? {}, http_status: 403 },
      });
      res.status(403).json({ error: gate.error, message: gate.message });
      return;
    }

    for (const key of DEPRECATED_GATEWAY_TRANSACTIONS_QUERY_KEYS) {
      const raw = req.query?.[key];
      const first = Array.isArray(raw) ? raw[0] : raw;
      const s = typeof first === "string" ? first.trim() : "";
      if (s) {
        res.status(400).json({
          error: "unsupported_query_param",
          message: `This endpoint accepts only transaction_id (checkout reference string). Remove query parameter: ${key}.`,
        });
        return;
      }
    }

    const rawTxId = req.query?.transaction_id;
    const rawTxIdFirst = Array.isArray(rawTxId) ? rawTxId[0] : rawTxId;
    const txRefParsed = parseOptionalGatewayTransactionId(rawTxIdFirst);
    if (!txRefParsed.ok) {
      res.status(400).json({ error: txRefParsed.error });
      return;
    }
    if (!txRefParsed.value) {
      res.status(400).json({
        error: "transaction_id_required",
        message:
          "Query parameter transaction_id is required (same checkout reference string as deposit-address transaction_id or reference_id).",
      });
      return;
    }

    const gwEnv = gatewayEnvironmentFromKeyType(keyType);
    const t = await prisma.transaction.findFirst({
      where: {
        ...ACTIVE,
        referenceTransactionId: txRefParsed.value,
        wallet: {
          ...ACTIVE,
          merchantId: merchant.id,
          environment: gwEnv,
        },
      },
      orderBy: { createdAt: "desc" },
      include: {
        payerUser: { select: { externalUserId: true } },
        wallet: {
          select: {
            currency: true,
            network: true,
            environment: true,
            assignedUser: { select: { externalUserId: true } },
          },
        },
      },
    });

    if (!t) {
      auditGatewayApi(req, {
        action: "gateway_transactions_get",
        merchantId: merchant.id,
        actorType: "gateway_api_key",
        summary: "transactions GET 404 — transaction_not_found",
        metadata: { query: { transaction_id: "[redacted]" }, http_status: 404 },
      });
      res.status(404).json({ error: "transaction_not_found" });
      return;
    }

    const expectedByKey =
      await loadExpectedAtomicByWalletSessionForTransactions([t]);
    const body = serializeGatewayTransactionForApi(t, expectedByKey);
    auditGatewayApi(req, {
      action: "gateway_transactions_get",
      merchantId: merchant.id,
      actorType: "gateway_api_key",
      summary: `transactions GET 200 · id=${t.id}`,
      metadata: {
        query: { transaction_id: "[redacted]" },
        response_out: { status: 200, id: t.id },
        http_status: 200,
      },
    });
    res.json(body);
  } catch (e) {
    logger.error("gateway transactions GET failed", { err: String(e) });
    auditGatewayApi(req, {
      action: "gateway_transactions_get",
      merchantId: null,
      actorType: "gateway_api_key",
      summary: "transactions GET 500",
      metadata: {
        query: req.query ?? {},
        http_status: 500,
        error: String(e).slice(0, 500),
      },
    });
    res.status(500).json({ error: "internal error" });
  }
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

router.post("/api/v1/gateway/payout", async (req, res) => {
  try {
    const body = req.body ?? {};
    const auth = await authenticateGatewayJsonPost(req);
    if (!auth.ok) {
      auditGatewayApi(req, {
        action: "gateway_payout",
        merchantId: null,
        actorType: "gateway_api_key",
        summary: `payout POST ${auth.status} — ${auth.error}`,
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
    const gate = assertMerchantGatewayKeyAllowed(merchant, keyType);
    if (!gate.ok) {
      auditGatewayApi(req, {
        action: "gateway_payout",
        merchantId: merchant.id,
        actorType: "gateway_api_key",
        summary: `payout POST 403 — ${gate.error}`,
        metadata: { request_in: redactGatewayBody(body), http_status: 403 },
      });
      res.status(403).json({ error: gate.error, message: gate.message });
      return;
    }
    const gwEnv = gatewayEnvironmentFromKeyType(keyType);

    const chainRaw = String(body.chain ?? "")
      .trim()
      .toUpperCase();
    let rail = null;
    if (chainRaw === "TRON") {
      rail = resolveDepositRail("USDT", "TRC20");
    } else if (chainRaw === "ETH" || chainRaw === "ETHEREUM") {
      rail = resolveDepositRail("USDT", "ERC20");
    }
    if (!rail) {
      auditGatewayApi(req, {
        action: "gateway_payout",
        merchantId: merchant.id,
        actorType: "gateway_api_key",
        summary: "payout POST 400 — unsupported_chain",
        metadata: { request_in: redactGatewayBody(body), http_status: 400 },
      });
      res.status(400).json({
        error: "unsupported_chain",
        message: "chain must be TRON (TRC20 USDT) or ETH (ERC20 USDT).",
      });
      return;
    }
    if (!merchantChainAllowsRail(merchant, rail)) {
      auditGatewayApi(req, {
        action: "gateway_payout",
        merchantId: merchant.id,
        actorType: "gateway_api_key",
        summary: "payout POST 403 — rail_not_enabled_for_merchant",
        metadata: {
          request_in: redactGatewayBody(body),
          http_status: 403,
          chain: rail.chain,
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
        action: "gateway_payout",
        merchantId: merchant.id,
        actorType: "gateway_api_key",
        summary: "payout POST 403 — chain_disabled_for_platform",
        metadata: {
          request_in: redactGatewayBody(body),
          http_status: 403,
          chain: rail.chain,
        },
      });
      res.status(403).json({
        error: "chain_disabled_for_platform",
        message: `Chain ${rail.chain} is disabled by the operator.`,
      });
      return;
    }

    const merch = await prisma.merchant.findFirst({
      where: { id: merchant.id, ...ACTIVE },
      select: {
        mdrPercent: true,
        payoutMdrPercent: true,
        settlementRatePercent: true,
        minSettlementAmount: true,
        payoutMinAmountHuman: true,
        payoutMaxAmountHuman: true,
        payoutRailsPolicyJson: true,
        payoutTreasuryAddressesJson: true,
      },
    });
    if (!merch) {
      res.status(404).json({ error: "merchant_not_found" });
      return;
    }

    const payoutRailKey = payoutRailKeyForChain(rail.chain);
    const effPayout =
      payoutRailKey != null
        ? effectivePayoutPolicyForRail(merch, payoutRailKey)
        : {
            min: merch.payoutMinAmountHuman ?? "0",
            max: merch.payoutMaxAmountHuman ?? "0",
            treasury: "",
          };

    const chainOut = rail.chain === Chain.TRON ? "TRON" : "ETH";
    const result = await createMerchantWithdrawalRequest({
      merchantId: merchant.id,
      environment: gwEnv,
      chainInput: chainOut,
      tokenSymbolInput: body.token_symbol ?? body.tokenSymbol ?? "USDT",
      toAddressRaw: body.to_address ?? body.toAddress,
      amountRaw: body.amount,
      rates: merch,
      payoutPolicy: {
        payoutMinAmountHuman: effPayout.min,
        payoutMaxAmountHuman: effPayout.max,
      },
      clientReferenceId: body.client_reference_id ?? body.clientReferenceId,
      forceFail: body.force_fail ?? body.forceFail,
      simulateResult: body.simulate_result ?? body.simulateResult,
      source: "gateway_api",
    });

    if (!result.ok) {
      auditGatewayApi(req, {
        action: "gateway_payout",
        merchantId: merchant.id,
        actorType: "gateway_api_key",
        summary: `payout POST ${result.status} — ${result.error}`,
        metadata: {
          request_in: redactGatewayBody(body),
          http_status: result.status,
        },
      });
      res.status(result.status).json({
        error: result.error,
        ...(result.message ? { message: result.message } : {}),
        ...("environment" in result && result.environment
          ? { environment: result.environment }
          : {}),
      });
      return;
    }

    const executed = await executeAutoPayout(result.withdrawal.id, {
      forceFail: body.force_fail ?? body.forceFail,
      simulateResult: body.simulate_result ?? body.simulateResult,
    });
    const outRow = executed.withdrawal ?? result.withdrawal;

    auditGatewayApi(req, {
      action: "gateway_payout",
      merchantId: merchant.id,
      actorType: "gateway_api_key",
      summary: `payout POST 201 · id=${outRow.id} · status=${outRow.status}`,
      metadata: {
        request_in: redactGatewayBody(body),
        response_out: {
          id: outRow.id,
          status: outRow.status,
          http_status: 201,
        },
        occurred_at_iso: new Date().toISOString(),
      },
    });
    res.status(201).json(withdrawalGatewayPayoutJson(outRow));
  } catch (e) {
    logger.error("gateway payout POST failed", { err: String(e) });
    auditGatewayApi(req, {
      action: "gateway_payout",
      merchantId: null,
      actorType: "gateway_api_key",
      summary: "payout POST 500",
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

router.get("/api/v1/gateway/payout", async (req, res) => {
  try {
    const auth = await authenticateGatewaySupportedCurrencyGet(req);
    if (!auth.ok) {
      auditGatewayApi(req, {
        action: "gateway_payout_get",
        merchantId: null,
        actorType: "gateway_api_key",
        summary: `payout GET ${auth.status} — ${auth.error}`,
        metadata: { query: req.query ?? {}, http_status: auth.status },
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
        action: "gateway_payout_get",
        merchantId: merchant.id,
        actorType: "gateway_api_key",
        summary: `payout GET 403 — ${gate.error}`,
        metadata: { query: req.query ?? {}, http_status: 403 },
      });
      res.status(403).json({ error: gate.error, message: gate.message });
      return;
    }

    const rawId = req.query?.payout_id ?? req.query?.id;
    const rawIdFirst = Array.isArray(rawId) ? rawId[0] : rawId;
    const idStr = typeof rawIdFirst === "string" ? rawIdFirst.trim() : "";
    if (idStr) {
      res.status(400).json({
        error: "payout_id_not_supported",
        message:
          "Look up payouts with client_reference_id only. Send the same value you passed when creating the payout.",
      });
      return;
    }

    const rawRef =
      req.query?.client_reference_id ?? req.query?.clientReferenceId;
    const rawRefFirst = Array.isArray(rawRef) ? rawRef[0] : rawRef;
    const cref =
      typeof rawRefFirst === "string" ? rawRefFirst.trim().slice(0, 256) : "";

    if (!cref) {
      res.status(400).json({
        error: "client_reference_id_required",
        message:
          "Pass query client_reference_id (the id you sent on POST /gateway/payout when creating the payout).",
      });
      return;
    }

    const gwEnv = gatewayEnvironmentFromKeyType(keyType);
    const row = await prisma.withdrawal.findFirst({
      where: {
        merchantId: merchant.id,
        environment: gwEnv,
        clientReferenceId: cref,
        ...ACTIVE,
      },
      orderBy: { id: "desc" },
    });

    if (!row) {
      auditGatewayApi(req, {
        action: "gateway_payout_get",
        merchantId: merchant.id,
        actorType: "gateway_api_key",
        summary: "payout GET 404 — not_found",
        metadata: { query: { client_reference_id: "[ref]" }, http_status: 404 },
      });
      res.status(404).json({ error: "payout_not_found" });
      return;
    }

    auditGatewayApi(req, {
      action: "gateway_payout_get",
      merchantId: merchant.id,
      actorType: "gateway_api_key",
      summary: `payout GET 200 · id=${row.id}`,
      metadata: {
        query: { client_reference_id: "[ref]" },
        http_status: 200,
      },
    });
    await fillMissingWithdrawalNetworkFees([row]);
    res.json(withdrawalGatewayPayoutJson(row));
  } catch (e) {
    logger.error("gateway payout GET failed", { err: String(e) });
    res.status(500).json({ error: "internal error" });
  }
});

export { router as gatewayRouter };
