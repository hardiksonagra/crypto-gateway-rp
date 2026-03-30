/**
 * PM2 deploy from monorepo root (after `npm run build` + Prisma migrate + generate).
 *
 * Prereqs: `.env` at repo root or `server/.env` with DATABASE_URL, JWT_SECRET, MNEMONIC, RPC_*, etc.
 *
 * - API process: HTTP + React static (`client/dist` auto-detected when present).
 * - Cron process: blockchain deposit scanner (`setInterval`), TRON USDT auto-sweep schedule, wallet-pool expired-hold cleanup, and any other `node-cron` jobs — all under `cron/` only (API has no timers).
 */
module.exports = {
  apps: [
    {
      name: "crypto-gateway-api",
      cwd: "./server",
      script: "src/index.js",
      interpreter: "node",
      instances: 1,
      autorestart: true,
      max_memory_restart: "600M",
      env: {
        NODE_ENV: "production",
        // Optional override if `client/dist` is not next to this repo layout:
        // CLIENT_DIST_PATH: "/var/www/crypto-gateway/client/dist",
      },
    },
    {
      name: "crypto-gateway-cron",
      cwd: "./cron",
      script: "src/index.js",
      interpreter: "node",
      instances: 1,
      autorestart: true,
      max_memory_restart: "500M",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
