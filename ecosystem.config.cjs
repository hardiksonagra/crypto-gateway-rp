/**
 * PM2 from monorepo root (after `npm run build` + Prisma migrate + generate).
 *
 * Apps:
 * - `crypto-gateway-api` — HTTP + static client (no timers).
 * - `crypto-gateway-worker` — deposit / transaction tracker (`WORKER_POLL_INTERVAL_MS`).
 * - `crypto-gateway-cron-1` — maintenance schedules (example heartbeat, wallet-pool holds).
 * - `crypto-gateway-cron-2` — TRON USDT auto-sweep (and similar heavy jobs).
 *
 * Add another process: copy the cron-2 block, add `jobs/group3.js`, `run-cron-3.js`, `entry-cron-3.js`,
 * register jobs in the new group only (do not duplicate jobs across processes).
 *
 * Local all-in-one (no PM2 split): `npm run start -w cron` → `cron/src/index.js`.
 *
 * Multi-host / React vs API vs Cron: `docs/split-services.md`.
 *
 * Fresh PM2 slate: from repo root `npm run pm2:resync` runs `pm2 delete all` then starts these apps only.
 */
module.exports = {
  apps: [
    {
      name: "crypto-gateway-api",
      cwd: "./server",
      script: "src/index.js",
      interpreter: "node",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_memory_restart: "600M",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "crypto-gateway-worker",
      cwd: "./cron",
      script: "src/entry-worker.js",
      interpreter: "node",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_memory_restart: "500M",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "crypto-gateway-cron-1",
      cwd: "./cron",
      script: "src/entry-cron-1.js",
      interpreter: "node",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_memory_restart: "400M",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "crypto-gateway-cron-2",
      cwd: "./cron",
      script: "src/entry-cron-2.js",
      interpreter: "node",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_memory_restart: "400M",
      env: {
        NODE_ENV: "production",
      },
    },
    // {
    //   name: "crypto-gateway-cron-3",
    //   cwd: "./cron",
    //   script: "src/entry-cron-3.js",
    //   interpreter: "node",
    //   exec_mode: "fork",
    //   instances: 1,
    //   autorestart: true,
    //   max_memory_restart: "400M",
    //   env: { NODE_ENV: "production" },
    // },
  ],
};
