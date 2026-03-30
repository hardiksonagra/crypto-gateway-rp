import fs from "fs";
import path from "path";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { env, normalizeBrowserOrigin } from "./config/env.js";
import { re } from "./config/runtime-env.js";
import { logger } from "./lib/logger.js";

/** When `CLIENT_ORIGINS` (env or DB) omits Vite/React dev URLs, local CORS still works. */
const LOCAL_DEV_BROWSER_ORIGINS = new Set(
  [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
  ].map(normalizeBrowserOrigin),
);

/**
 * @param {string} absoluteUrl
 * @returns {string | null}
 */
function browserOriginFromAbsoluteUrl(absoluteUrl) {
  const s = String(absoluteUrl ?? "").trim();
  if (!s) return null;
  try {
    return normalizeBrowserOrigin(new URL(s).origin);
  } catch {
    return null;
  }
}

/**
 * CORS allow-list: `CLIENT_ORIGINS` entries plus origins from `APP_PUBLIC_URL` and
 * `PAYMENT_PAGE_PUBLIC_URL` (so production SPA works even if the list was saved with only local URLs),
 * and localhost dev ports when `NODE_ENV=development`.
 * Rebuilt each request so Admin / DB overrides apply without restart.
 * @returns {Set<string>}
 */
function effectiveCorsOriginSet() {
  const set = new Set(re.clientOrigins);
  const appO = browserOriginFromAbsoluteUrl(re.appPublicUrl);
  if (appO) set.add(appO);
  const payO = browserOriginFromAbsoluteUrl(re.paymentPagePublicUrl);
  if (payO) set.add(payO);
  if (env.nodeEnv === "development") {
    for (const o of LOCAL_DEV_BROWSER_ORIGINS) {
      set.add(o);
    }
  }
  return set;
}

import { authRouter } from "./api/auth-routes.js";
import { gatewayRouter } from "./api/gateway-routes.js";
import { adminRouter } from "./api/admin-routes.js";
import { merchantRouter } from "./api/merchant-routes.js";

export function createApp() {
  const app = express();
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );
  app.use(
    cors({
      origin(origin, cb) {
        const allowed = effectiveCorsOriginSet();
        if (allowed.size === 0) {
          return cb(null, true);
        }
        if (!origin) {
          return cb(null, true);
        }
        const norm = normalizeBrowserOrigin(origin);
        if (allowed.has(norm)) {
          return cb(null, true);
        }
        logger.warn("cors_origin_rejected", {
          origin,
          hint: "Add scheme+host (no path) to CLIENT_ORIGINS, or set APP_PUBLIC_URL / PAYMENT_PAGE_PUBLIC_URL to your live app base URL (its origin is allowed automatically). In development, localhost / 127.0.0.1 on ports 5173, 3000, 4173 are merged in.",
        });
        cb(null, false);
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "Accept",
        "X-Requested-With",
      ],
      maxAge: 86_400,
    }),
  );
  const jsonParser = express.json({ limit: "512kb" });
  app.use((req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      return next();
    }
    return jsonParser(req, res, next);
  });

  const dist = env.clientDistPath;
  const serveSpa = Boolean(dist && fs.existsSync(dist));

  if (!serveSpa) {
    app.get("/", (_req, res) => {
      res.json({
        ok: true,
        service: "crypto-payment-gateway-api",
        login: "POST /api/v1/auth/login (JSON: { email, password })",
        health: "GET /health",
        note: "Run the server workspace: npm run dev -w server (PORT from .env, default 3000).",
      });
    });
  }

  app.use(authRouter);
  app.use(gatewayRouter);
  app.use(adminRouter);
  app.use(merchantRouter);

  if (serveSpa) {
    app.use(express.static(dist, { index: false }));
    const indexHtml = path.join(dist, "index.html");
    app.use((req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") {
        next();
        return;
      }
      const p = req.path;
      if (p.startsWith("/api") || p === "/health") {
        next();
        return;
      }
      if (!fs.existsSync(indexHtml)) {
        next();
        return;
      }
      res.sendFile(indexHtml, (err) => {
        if (err) next(err);
      });
    });
  }

  app.use((req, res) => {
    res.status(404).json({
      error: "not_found",
      method: req.method,
      path: req.originalUrl,
      hint: serveSpa
        ? "Unknown API path. The React app is served for non-API routes."
        : "If you expected login: POST JSON to /api/v1/auth/login with this API process listening (npm run dev -w server). SPA dev uses Vite on :5173 and proxies /api to the API port.",
    });
  });

  return app;
}
