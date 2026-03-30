/**
 * PM2 deploy from monorepo root (after `npm run build` + Prisma migrate + generate).
 *
 * Prereqs: `.env` at repo root or `server/.env` with DATABASE_URL, JWT_SECRET, MNEMONIC, RPC_*, etc.
 *
 * - API (`crypto-gateway-api`): HTTP + React static (`client/dist` when present). No timers.
 * - Cron (`crypto-gateway-cron`): **all** scheduled/timer work in **one** process (`cron/src/run.js`):
 *   - Deposit / transaction tracker: `startBlockchainWorker()` (`WORKER_POLL_INTERVAL_MS`)
 *   - `node-cron` jobs from `cron/src/jobs/index.js`: example heartbeat, wallet-pool expired holds, TRON USDT auto-sweep
 *
 * `pm2 start ecosystem.config.cjs` starts both apps; you do **not** need a separate PM2 app per cron expression.
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
