import fs from "fs";
import path from "path";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { env, normalizeBrowserOrigin } from "./config/env.js";
import { re } from "./config/runtime-env.js";
import { getResolvedString } from "./lib/app-settings-runtime.js";
import { logger } from "./lib/logger.js";

/** When `CLIENT_ORIGINS` (env or DB) omits Vite/React dev URLs, local CORS still works. */
const LOCAL_DEV_BROWSER_ORIGINS = new Set(
  [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
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
 * `CLIENT_ORIGINS` is exactly `*` or contains a `*` entry → reflect any request Origin (like CORS_ALLOW_ALL).
 */
function clientOriginsWildcardEnabled() {
  const raw = getResolvedString("CLIENT_ORIGINS", () =>
    env.clientOrigins.join(","),
  );
  const t = raw.trim();
  if (t === "*") return true;
  return raw.split(",").some((s) => s.trim() === "*");
}

/**
 * @param {string} originNorm normalized origin URL
 * @param {string} suffixRoot e.g. `example.com`
 */
function originMatchesDomainSuffix(originNorm, suffixRoot) {
  const suffix = String(suffixRoot ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\./, "");
  if (!suffix) return false;
  try {
    const h = new URL(originNorm).hostname.toLowerCase();
    return h === suffix || h.endsWith(`.${suffix}`);
  } catch {
    return false;
  }
}

/**
 * Also allow the same host with/without leading `www.` (common live mismatch vs `APP_PUBLIC_URL`).
 * Skips IPv4 hostnames.
 * @param {Set<string>} set
 */
function addWwwOriginVariants(set) {
  const extras = [];
  for (const o of set) {
    if (!o || typeof o !== "string") continue;
    const t = o.trim();
    if (!t.includes("://")) continue;
    try {
      const u = new URL(t);
      const h = u.hostname;
      if (!h || /^\d{1,3}(\.\d{1,3}){3}$/.test(h)) continue;
      if (h.startsWith("www.")) {
        const u2 = new URL(u.href);
        u2.hostname = h.slice(4);
        if (u2.hostname) extras.push(normalizeBrowserOrigin(u2.origin));
      } else {
        const u2 = new URL(u.href);
        u2.hostname = `www.${h}`;
        extras.push(normalizeBrowserOrigin(u2.origin));
      }
    } catch {
      /* skip */
    }
  }
  for (const e of extras) {
    if (e) set.add(e);
  }
}

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
  addWwwOriginVariants(set);
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
        if (env.corsAllowAll || clientOriginsWildcardEnabled()) {
          return cb(null, true);
        }
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
        if (
          env.corsAllowedOriginSuffix &&
          originMatchesDomainSuffix(norm, env.corsAllowedOriginSuffix)
        ) {
          return cb(null, true);
        }
        logger.warn("cors_origin_rejected", {
          origin,
          hint: "Fix Admin → System settings CLIENT_ORIGINS / APP_PUBLIC_URL (DB overrides .env). Or .env: CLIENT_ORIGINS=https://portal.yourdomain.com matching the page URL exactly (https not http). Or CORS_ALLOWED_ORIGIN_SUFFIX=yourdomain.com for all subdomains. Or CLIENT_ORIGINS=* or CORS_ALLOW_ALL=true (temporary).",
        });
        cb(null, false);
      },
      credentials: true,
      // Must include GET/HEAD: requests with `Authorization` are not “simple” and trigger a
      // preflight; browsers require the actual method (e.g. GET for /auth/me) in Allow-Methods.
      methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      // Omit allowedHeaders so the `cors` package mirrors `Access-Control-Request-Headers`
      // (avoids preflight failures when browsers/extensions add extra request headers).
      maxAge: 86_400,
    }),
  );
  // strict: false allows top-level JSON `null` / primitives (strict mode rejects them).
  const jsonParser = express.json({ limit: "512kb", strict: false });
  app.use((req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      return next();
    }
    const ct = String(req.headers["content-type"] ?? "").toLowerCase();
    if (
      ct.includes("application/json") &&
      req.headers["content-length"] === "0"
    ) {
      req.body = {};
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
        login_merchant: "POST /api/v1/auth/login",
        login_admin: "POST /api/v1/auth/login/admin",
        login_body: '{ "email", "password" }',
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

  app.use((err, req, res, next) => {
    if (err?.type === "entity.parse.failed") {
      res.status(400).json({
        error: "invalid_json",
        message:
          "Body must be valid JSON when Content-Type is application/json (empty body: send {} or omit the header).",
      });
      return;
    }
    next(err);
  });

  app.use((req, res) => {
    res.status(404).json({
      error: "not_found",
      method: req.method,
      path: req.originalUrl,
      hint: serveSpa
        ? "Unknown API path. The React app is served for non-API routes."
        : "Portal login: merchants POST /api/v1/auth/login, admins POST /api/v1/auth/login/admin (JSON { email, password }). npm run dev -w server. SPA dev: Vite :5173 proxies /api.",
    });
  });

  return app;
}
