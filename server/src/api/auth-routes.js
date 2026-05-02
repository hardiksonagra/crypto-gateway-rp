import { Router } from "express";
import crypto from "crypto";
import bcrypt from "bcrypt";
import { MerchantGatewayEnv } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { signAuthToken } from "../lib/auth-jwt.js";
import { requireAuth } from "../middleware/require-auth.js";
import {
  PORTAL_ROLE_ADMIN,
  PORTAL_ROLE_MERCHANT,
  PORTAL_ROLE_RP,
} from "../constants/portal-role.js";
import { decryptMerchantApiKey } from "../lib/merchant-api-key-cipher.js";
import {
  assertPortalEnvironmentUpdateAllowed,
  ensureMerchantPortalEnvironmentConsistent,
} from "../lib/merchant-gateway-env.js";
import { logger } from "../lib/logger.js";
import { re } from "../config/runtime-env.js";
import { listMerchantSelectableChainsForAdmin } from "../lib/chain-enable.js";
import {
  depositRailKey,
  listMerchantSupportedCurrencyPairs,
} from "../config/payment-rails.js";
import {
  logAuthenticatedPortalMutation,
  redactPanelBody,
} from "../services/panel-audit-log.js";
import { sendPasswordResetEmail } from "../lib/mailer.js";
import { getTrxSweepFunderDisplayAddress } from "../lib/trx-sweep-funder-display.js";

const router = Router();

/** @param {unknown} sub */
function portalAccountPkFromJwtSub(sub) {
  const n = parseInt(String(sub ?? "").trim(), 10);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/** @param {string} token */
function hashResetToken(token) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

router.get("/api/v1/auth/login", (_req, res) => {
  res.status(405).setHeader("Allow", "POST").json({
    error: "method_not_allowed",
    message:
      'Merchant login: POST JSON { "email", "password" } here. Admins use POST /api/v1/auth/login/admin (see /control/login in the app).',
  });
});

router.get("/api/v1/auth/login/admin", (_req, res) => {
  res.status(405).setHeader("Allow", "POST").json({
    error: "method_not_allowed",
    message:
      'Admin login: POST JSON { "email", "password" } to this path. Merchants use POST /api/v1/auth/login (see /login).',
  });
});

/** Merchant portal only — queries `merchants` table. */
async function merchantLoginHandler(req, res) {
  const body = req.body ?? {};
  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? "";
  if (!email || !password) {
    res.status(400).json({ error: "email and password required" });
    return;
  }
  const account = await prisma.merchant.findFirst({
    where: { email, deletedAt: null },
  });
  if (!account || !account.isActive) {
    res.status(401).json({ error: "invalid_credentials" });
    return;
  }
  const ok = await bcrypt.compare(password, account.passwordHash);
  if (!ok) {
    res.status(401).json({ error: "invalid_credentials" });
    return;
  }
  const token = signAuthToken({ sub: String(account.id), role: PORTAL_ROLE_MERCHANT });
  res.json({
    token,
    role: PORTAL_ROLE_MERCHANT,
    email: account.email,
    display_name: account.displayName,
  });
}

/** Control / ops portal only — queries `admins` table. */
async function adminLoginHandler(req, res) {
  const body = req.body ?? {};
  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? "";
  if (!email || !password) {
    res.status(400).json({ error: "email and password required" });
    return;
  }
  const account = await prisma.admin.findFirst({
    where: { email, deletedAt: null },
  });
  if (!account || !account.isActive) {
    res.status(401).json({ error: "invalid_credentials" });
    return;
  }
  const ok = await bcrypt.compare(password, account.passwordHash);
  if (!ok) {
    res.status(401).json({ error: "invalid_credentials" });
    return;
  }
  const token = signAuthToken({ sub: String(account.id), role: PORTAL_ROLE_ADMIN });
  res.json({
    token,
    role: PORTAL_ROLE_ADMIN,
    email: account.email,
    display_name: account.displayName,
  });
}

/** Reseller partner portal — queries `reseller_partners` table. */
async function resellerPartnerLoginHandler(req, res) {
  const body = req.body ?? {};
  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? "";
  if (!email || !password) {
    res.status(400).json({ error: "email and password required" });
    return;
  }
  const account = await prisma.resellerPartner.findFirst({
    where: { email, deletedAt: null },
  });
  if (!account || !account.isActive) {
    res.status(401).json({ error: "invalid_credentials" });
    return;
  }
  const ok = await bcrypt.compare(password, account.passwordHash);
  if (!ok) {
    res.status(401).json({ error: "invalid_credentials" });
    return;
  }
  const token = signAuthToken({
    sub: String(account.id),
    role: PORTAL_ROLE_RP,
  });
  res.json({
    token,
    role: PORTAL_ROLE_RP,
    email: account.email,
    display_name: account.displayName,
  });
}

router.post("/api/v1/auth/login", merchantLoginHandler);
router.post("/api/v1/auth/login/", merchantLoginHandler);
router.post("/api/v1/auth/login/admin", adminLoginHandler);
router.post("/api/v1/auth/login/admin/", adminLoginHandler);
router.post("/api/v1/auth/login/rp", resellerPartnerLoginHandler);
router.post("/api/v1/auth/login/rp/", resellerPartnerLoginHandler);

router.get("/api/v1/auth/me", requireAuth(), async (req, res) => {
  const id = req.auth?.sub;
  const jwtRole = req.auth?.role;
  if (!id || !jwtRole) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const pk = portalAccountPkFromJwtSub(id);
  if (pk == null) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  if (jwtRole === PORTAL_ROLE_ADMIN) {
    const user = await prisma.admin.findUnique({
      where: { id: pk },
      select: {
        id: true,
        email: true,
        displayName: true,
        isActive: true,
        portalEnvironment: true,
      },
    });
    if (!user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    res.json({
      id: user.id,
      email: user.email,
      role: PORTAL_ROLE_ADMIN,
      displayName: user.displayName,
      isActive: user.isActive,
      portalEnvironment: user.portalEnvironment,
      defaultChains: [],
      defaultCurrency: "USDT",
      defaultNetwork: "TRC20",
      supportedDepositRails: [],
      gateway_tron_usdt_only: false,
      gateway_supported_rail_keys: [],
      callbackUrl: null,
      apiKeyHint: null,
      sandboxApiKeyHint: null,
      liveGatewayEnabled: true,
      sandboxGatewayEnabled: true,
      hasSandboxApiKey: false,
    });
    return;
  }

  if (jwtRole === PORTAL_ROLE_RP) {
    const rp = await prisma.resellerPartner.findUnique({
      where: { id: pk },
      select: {
        id: true,
        email: true,
        displayName: true,
        mdrPercent: true,
        isActive: true,
        portalEnvironment: true,
      },
    });
    if (!rp) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    res.json({
      id: rp.id,
      email: rp.email,
      role: PORTAL_ROLE_RP,
      displayName: rp.displayName,
      mdr_percent: Number(rp.mdrPercent),
      isActive: rp.isActive,
      portalEnvironment: rp.portalEnvironment,
      defaultChains: [],
      defaultCurrency: "USDT",
      defaultNetwork: "TRC20",
      supportedDepositRails: [],
      gateway_tron_usdt_only: false,
      gateway_supported_rail_keys: [],
      callbackUrl: null,
      apiKeyHint: null,
      sandboxApiKeyHint: null,
      liveGatewayEnabled: true,
      sandboxGatewayEnabled: true,
      hasSandboxApiKey: false,
    });
    return;
  }

  if (jwtRole !== PORTAL_ROLE_MERCHANT) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const user = await prisma.merchant.findUnique({
    where: { id: pk },
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
      portalEnvironment: true,
      mdrPercent: true,
      settlementRatePercent: true,
      minSettlementAmount: true,
      settlementPeriodDays: true,
      apiKeyCipher: true,
      sandboxApiKeyCipher: true,
      sandboxApiKeyHash: true,
      autoSwapEnabled: true,
      autoSwapSettingsJson: true,
    },
  });
  if (!user) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const {
    apiKeyCipher,
    sandboxApiKeyCipher,
    sandboxApiKeyHash,
    mdrPercent,
    settlementRatePercent,
    minSettlementAmount,
    settlementPeriodDays,
    autoSwapEnabled,
    autoSwapSettingsJson,
    ...rest
  } = user;
  const out = {
    ...rest,
    role: PORTAL_ROLE_MERCHANT,
    mdr_percent: Number(mdrPercent),
    settlement_rate_percent: Number(settlementRatePercent),
    min_settlement_amount: minSettlementAmount ?? "0",
    settlement_period_days: Number(settlementPeriodDays ?? 0),
    auto_swap_enabled: Boolean(autoSwapEnabled),
    auto_swap_settings:
      typeof autoSwapSettingsJson === "object" && autoSwapSettingsJson !== null
        ? autoSwapSettingsJson
        : {},
  };
  out.hasSandboxApiKey = Boolean(sandboxApiKeyHash);
  out.api_key_cipher_present = Boolean(apiKeyCipher);
  if (apiKeyCipher) {
    try {
      out.apiKey = decryptMerchantApiKey(apiKeyCipher);
    } catch (e) {
      logger.warn("auth/me decrypt merchant api key failed", {
        err: String(e),
        userId: user.id,
      });
    }
  }
  if (sandboxApiKeyCipher) {
    try {
      out.sandboxApiKey = decryptMerchantApiKey(sandboxApiKeyCipher);
    } catch (e) {
      logger.warn("auth/me decrypt merchant sandbox api key failed", {
        err: String(e),
        userId: user.id,
      });
    }
  }
  const synced = await ensureMerchantPortalEnvironmentConsistent(user.id);
  if (synced) {
    out.portalEnvironment = synced.portalEnvironment;
  }
  out.platform_enabled_chains = listMerchantSelectableChainsForAdmin(
    re.chainEnabledRecord,
  );
  const gatewayPairs = listMerchantSupportedCurrencyPairs(user);
  out.gateway_tron_usdt_only = re.gatewayTronUsdtOnly;
  out.gateway_supported_rail_keys = gatewayPairs.map((p) =>
    depositRailKey(p.currency, p.network),
  );
  {
    const a = getTrxSweepFunderDisplayAddress().trim();
    out.auto_swap_trx_fee_source_address = a || null;
  }
  res.json(out);
});

router.patch("/api/v1/auth/me/portal-environment", requireAuth(), async (req, res) => {
  const id = req.auth?.sub;
  const pk = portalAccountPkFromJwtSub(id);
  if (pk == null) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const body = req.body ?? {};
  const raw = body.portal_environment ?? body.portalEnvironment;
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (v !== "live" && v !== "sandbox") {
    res.status(400).json({
      error: "invalid_portal_environment",
      message: "portal_environment must be live or sandbox.",
    });
    return;
  }
  const next =
    v === "sandbox" ? MerchantGatewayEnv.sandbox : MerchantGatewayEnv.live;
  const gate = await assertPortalEnvironmentUpdateAllowed(pk, next);
  if (!gate.ok) {
    res.status(gate.status).json({
      error: gate.error,
      ...(gate.message ? { message: gate.message } : {}),
    });
    return;
  }
  if (req.auth.role === PORTAL_ROLE_ADMIN) {
    await prisma.admin.update({
      where: { id: pk },
      data: { portalEnvironment: next },
    });
  } else if (req.auth.role === PORTAL_ROLE_RP) {
    await prisma.resellerPartner.update({
      where: { id: pk },
      data: { portalEnvironment: next },
    });
  } else {
    await prisma.merchant.update({
      where: { id: pk },
      data: { portalEnvironment: next },
    });
  }
  logAuthenticatedPortalMutation(req, {
    path: "/api/v1/auth/me/portal-environment",
    summary: `Profile: portal environment → ${v}`,
    metadata: {
      portal_environment: v,
      request_body: redactPanelBody(body),
    },
  });
  res.json({ ok: true, portal_environment: v });
});

const forgotPasswordResponse = {
  ok: true,
  message: "If an account exists for that email, a reset link was sent.",
};

async function forgotPasswordHandler(req, res) {
  const email = req.body?.email?.trim().toLowerCase();
  if (!email) {
    res.status(400).json({ error: "email required" });
    return;
  }
  const adminAcc = await prisma.admin.findFirst({
    where: { email, deletedAt: null },
  });
  const merchAcc = adminAcc
    ? null
    : await prisma.merchant.findFirst({ where: { email, deletedAt: null } });
  const account = adminAcc ?? merchAcc;
  if (!account?.isActive) {
    res.json(forgotPasswordResponse);
    return;
  }
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashResetToken(token);
  const expires = new Date(Date.now() + re.passwordResetTtlMinutes * 60_000);
  if (adminAcc) {
    await prisma.admin.update({
      where: { id: account.id },
      data: {
        passwordResetTokenHash: tokenHash,
        passwordResetExpiresAt: expires,
      },
    });
  } else {
    await prisma.merchant.update({
      where: { id: account.id },
      data: {
        passwordResetTokenHash: tokenHash,
        passwordResetExpiresAt: expires,
      },
    });
  }
  const base = re.appPublicUrl.replace(/\/$/, "");
  const resetUrl = `${base}/reset-password?token=${encodeURIComponent(token)}`;
  try {
    await sendPasswordResetEmail({ to: account.email, resetUrl });
  } catch (e) {
    logger.error("password_reset_email_failed", {
      err: String(e),
      userId: account.id,
    });
  }
  res.json(forgotPasswordResponse);
}

router.post("/api/v1/auth/forgot-password", forgotPasswordHandler);
router.post("/api/v1/auth/forgot-password/", forgotPasswordHandler);

async function resetPasswordHandler(req, res) {
  const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  const newPassword = req.body?.new_password ?? "";
  if (!token || !newPassword) {
    res.status(400).json({ error: "token and new_password required" });
    return;
  }
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    res.status(400).json({ error: "new_password_too_short" });
    return;
  }
  const tokenHash = hashResetToken(token);
  const resetWhere = {
    passwordResetTokenHash: tokenHash,
    passwordResetExpiresAt: { gt: new Date() },
    deletedAt: null,
  };
  const adminHit = await prisma.admin.findFirst({ where: resetWhere });
  const merchHit = adminHit
    ? null
    : await prisma.merchant.findFirst({ where: resetWhere });
  const account = adminHit ?? merchHit;
  if (!account?.isActive) {
    res.status(400).json({ error: "invalid_or_expired_token" });
    return;
  }
  const hashed = await bcrypt.hash(newPassword, 10);
  if (adminHit) {
    await prisma.admin.update({
      where: { id: account.id },
      data: {
        passwordHash: hashed,
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
      },
    });
  } else {
    await prisma.merchant.update({
      where: { id: account.id },
      data: {
        passwordHash: hashed,
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
      },
    });
  }
  res.json({ ok: true });
}

router.post("/api/v1/auth/reset-password", resetPasswordHandler);
router.post("/api/v1/auth/reset-password/", resetPasswordHandler);

async function changePasswordHandler(req, res) {
  const current = req.body?.current_password ?? "";
  const newPassword = req.body?.new_password ?? "";
  if (!current || !newPassword) {
    res.status(400).json({ error: "current_password and new_password required" });
    return;
  }
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    res.status(400).json({ error: "new_password_too_short" });
    return;
  }
  const id = req.auth?.sub;
  const jwtRole = req.auth?.role;
  if (!id || !jwtRole) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const pk = portalAccountPkFromJwtSub(id);
  if (pk == null) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const pwdRow =
    jwtRole === PORTAL_ROLE_ADMIN
      ? await prisma.admin.findUnique({
          where: { id: pk },
          select: { passwordHash: true, isActive: true, deletedAt: true },
        })
      : await prisma.merchant.findUnique({
          where: { id: pk },
          select: { passwordHash: true, isActive: true, deletedAt: true },
        });
  if (!pwdRow?.isActive || pwdRow.deletedAt) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const ok = await bcrypt.compare(current, pwdRow.passwordHash);
  if (!ok) {
    res.status(400).json({ error: "current_password_invalid" });
    return;
  }
  const hashed = await bcrypt.hash(newPassword, 10);
  if (jwtRole === PORTAL_ROLE_ADMIN) {
    await prisma.admin.update({
      where: { id: pk },
      data: {
        passwordHash: hashed,
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
      },
    });
  } else {
    await prisma.merchant.update({
      where: { id: pk },
      data: {
        passwordHash: hashed,
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
      },
    });
  }
  logAuthenticatedPortalMutation(req, {
    path: "/api/v1/auth/me/password",
    summary: "Profile: password changed",
    metadata: {
      request_body: redactPanelBody(req.body ?? {}),
    },
  });
  res.json({ ok: true });
}

router.patch("/api/v1/auth/me/password", requireAuth(), changePasswordHandler);
router.patch("/api/v1/auth/me/password/", requireAuth(), changePasswordHandler);

router.get("/health", (_req, res) => {
  res.json({ ok: true });
});

export { router as authRouter };
