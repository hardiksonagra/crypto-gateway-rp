import { Router } from "express";
import bcrypt from "bcrypt";
import { AdminRole } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { signAuthToken } from "../lib/auth-jwt.js";
import { requireAuth } from "../middleware/require-auth.js";
import { decryptMerchantApiKey } from "../lib/merchant-api-key-cipher.js";
import { logger } from "../lib/logger.js";

const router = Router();

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

router.get("/health", (_req, res) => {
  res.json({ ok: true });
});

export { router as authRouter };
