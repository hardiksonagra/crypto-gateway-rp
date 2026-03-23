import { Router } from "express";
import crypto from "crypto";
import bcrypt from "bcrypt";
import { AdminRole } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { signAuthToken } from "../lib/auth-jwt.js";
import { requireAuth } from "../middleware/require-auth.js";
import { decryptMerchantApiKey } from "../lib/merchant-api-key-cipher.js";
import { logger } from "../lib/logger.js";
import { sendPasswordResetEmail } from "../lib/mailer.js";
import { env } from "../config/env.js";

const router = Router();

/** @param {string} token */
function hashResetToken(token) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

router.get("/api/v1/auth/login", (_req, res) => {
  res.status(405).setHeader("Allow", "POST").json({
    error: "method_not_allowed",
    message:
      'Login is POST only. Send JSON: { "email": "…", "password": "…" }. Open /login in the app, or use curl/Postman.',
  });
});

async function loginHandler(req, res) {
  const body = req.body ?? {};
  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? "";
  if (!email || !password) {
    res.status(400).json({ error: "email and password required" });
    return;
  }
  const user = await prisma.adminUser.findUnique({ where: { email } });
  if (!user || !user.isActive) {
    res.status(401).json({ error: "invalid_credentials" });
    return;
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    res.status(401).json({ error: "invalid_credentials" });
    return;
  }
  const token = signAuthToken({ sub: user.id, role: user.role });
  res.json({
    token,
    role: user.role,
    email: user.email,
    display_name: user.displayName,
  });
}

router.post("/api/v1/auth/login", loginHandler);
router.post("/api/v1/auth/login/", loginHandler);

router.get("/api/v1/auth/me", requireAuth(), async (req, res) => {
  const id = req.auth?.sub;
  if (!id) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const user = await prisma.adminUser.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      role: true,
      displayName: true,
      defaultChains: true,
      defaultCurrency: true,
      defaultNetwork: true,
      supportedDepositRails: true,
      callbackUrl: true,
      apiKeyHint: true,
      isActive: true,
      apiKeyCipher: true,
    },
  });
  if (!user) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const { apiKeyCipher, ...rest } = user;
  const out = { ...rest };
  if (user.role === AdminRole.MERCHANT && apiKeyCipher) {
    try {
      out.apiKey = decryptMerchantApiKey(apiKeyCipher);
    } catch (e) {
      logger.warn("auth/me decrypt merchant api key failed", {
        err: String(e),
        userId: user.id,
      });
    }
  }
  res.json(out);
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
  const user = await prisma.adminUser.findUnique({ where: { email } });
  if (!user?.isActive) {
    res.json(forgotPasswordResponse);
    return;
  }
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashResetToken(token);
  const expires = new Date(Date.now() + env.passwordResetTtlMinutes * 60_000);
  await prisma.adminUser.update({
    where: { id: user.id },
    data: {
      passwordResetTokenHash: tokenHash,
      passwordResetExpiresAt: expires,
    },
  });
  const base = env.appPublicUrl.replace(/\/$/, "");
  const resetUrl = `${base}/reset-password?token=${encodeURIComponent(token)}`;
  try {
    await sendPasswordResetEmail({ to: user.email, resetUrl });
  } catch (e) {
    logger.error("password_reset_email_failed", {
      err: String(e),
      userId: user.id,
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
  const user = await prisma.adminUser.findFirst({
    where: {
      passwordResetTokenHash: tokenHash,
      passwordResetExpiresAt: { gt: new Date() },
    },
  });
  if (!user?.isActive) {
    res.status(400).json({ error: "invalid_or_expired_token" });
    return;
  }
  await prisma.adminUser.update({
    where: { id: user.id },
    data: {
      passwordHash: await bcrypt.hash(newPassword, 10),
      passwordResetTokenHash: null,
      passwordResetExpiresAt: null,
    },
  });
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
  if (!id) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const user = await prisma.adminUser.findUnique({ where: { id } });
  if (!user?.isActive) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const ok = await bcrypt.compare(current, user.passwordHash);
  if (!ok) {
    res.status(400).json({ error: "current_password_invalid" });
    return;
  }
  await prisma.adminUser.update({
    where: { id },
    data: {
      passwordHash: await bcrypt.hash(newPassword, 10),
      passwordResetTokenHash: null,
      passwordResetExpiresAt: null,
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
