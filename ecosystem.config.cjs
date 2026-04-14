/**
 * PM2 from monorepo root (after `npm run build` + Prisma migrate + generate).
 *
 * Apps:
 * - `crypto-gateway-api` — HTTP + static client (no timers).
 * - `crypto-gateway-worker-erc20` — USDT·ERC20 deposit scan (`WORKER_POLL_INTERVAL_MS_ERC20`).
 * - `crypto-gateway-worker-trc20` — USDT·TRC20 deposit scan + callback retries (`WORKER_POLL_INTERVAL_MS_TRC20`).
 * - (Optional) `crypto-gateway-worker` — both rails in one process (`entry-worker.js`); prefer the split apps above in production.
 * - `crypto-gateway-cron-maintenance` — heartbeat + wallet-pool expired holds.
 * - `crypto-gateway-cron-deposit-full-scan` — periodic full live-wallet deposit scan (`DEPOSIT_FULL_SCAN_INTERVAL_HOURS`).
 * - `crypto-gateway-cron-tron-sweep` — TRON USDT auto-sweep (and similar chain-heavy jobs).
 *
 * Add another process: copy the tron-sweep block, add `jobs/group3.js`, `run-cron-3.js`, `entry-cron-3.js`,
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
      name: "crypto-gateway-worker-erc20",
      cwd: "./cron",
      script: "src/entry-worker-erc20.js",
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
      name: "crypto-gateway-worker-trc20",
      cwd: "./cron",
      script: "src/entry-worker-trc20.js",
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
      name: "crypto-gateway-cron-maintenance",
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
      name: "crypto-gateway-cron-deposit-full-scan",
      cwd: "./cron",
      script: "src/entry-cron-deposit-full-scan.js",
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
      name: "crypto-gateway-cron-tron-sweep",
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
    //   name: "crypto-gateway-cron-your-feature",
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
