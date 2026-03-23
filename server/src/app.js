import express from "express";
import cors from "cors";
import helmet from "helmet";
import { env } from "./config/env.js";
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
      origin:
        env.clientOrigins.length > 0
          ? (origin, cb) => {
              if (!origin) return cb(null, true);
              if (env.clientOrigins.includes(origin)) return cb(null, true);
              cb(null, false);
            }
          : true,
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    }),
  );
  const jsonParser = express.json({ limit: "512kb" });
  app.use((req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      return next();
    }
    return jsonParser(req, res, next);
  });

  app.get("/", (_req, res) => {
    res.json({
      ok: true,
      service: "crypto-payment-gateway-api",
      login: "POST /api/v1/auth/login (JSON: { email, password })",
      health: "GET /health",
      note: "Run the server workspace: npm run dev -w server (PORT from .env, default 3000).",
    });
  });

  app.use(authRouter);
  app.use(gatewayRouter);
  app.use(adminRouter);
  app.use(merchantRouter);

  app.use((req, res) => {
    res.status(404).json({
      error: "not_found",
      method: req.method,
      path: req.originalUrl,
      hint:
        "If you expected login: POST JSON to /api/v1/auth/login with this API process listening (npm run dev -w server). SPA dev uses Vite on :5173 and proxies /api to the API port.",
    });
  });

  return app;
}
