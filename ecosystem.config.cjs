/**
 * PM2 deploy from monorepo root (after `npm run build` + Prisma migrate + generate).
 *
 * Prereqs: `.env` at repo root or `server/.env` with DATABASE_URL, JWT_SECRET, MNEMONIC, RPC_*, etc.
 *
 * - API process: HTTP + React static (`client/dist` auto-detected when present).
 * - Worker process: blockchain scanner only (set RUN_BLOCKCHAIN_WORKER=false on API).
 *
 * One-process alternative: single app with `npm run start -w server` and omit worker app + set RUN_BLOCKCHAIN_WORKER=true (default).
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
        RUN_BLOCKCHAIN_WORKER: "false",
        // Optional override if `client/dist` is not next to this repo layout:
        // CLIENT_DIST_PATH: "/var/www/crypto-gateway/client/dist",
      },
    },
    {
      name: "crypto-gateway-worker",
      cwd: "./server",
      script: "src/worker-entry.js",
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
