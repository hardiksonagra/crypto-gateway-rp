import fs from "fs";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirnameEnv = path.dirname(fileURLToPath(import.meta.url));
const defaultClientDist = path.resolve(__dirnameEnv, "../../../client/dist");

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), "..", ".env") });

function required(name) {
  const v = process.env[name];
  if (!v?.trim()) throw new Error(`Missing required env: ${name}`);
  return v.trim();
}

function optional(name, fallback = "") {
  return process.env[name]?.trim() ?? fallback;
}

function intEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function listEnv(name, fallback) {
  return optional(name, fallback)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Browser `Origin` header has no trailing slash; allow matching env values written with one.
 * @param {string | undefined | null} o
 * @returns {string}
 */
export function normalizeBrowserOrigin(o) {
  if (!o) return "";
  return String(o).trim().replace(/\/+$/, "");
}

const clientDistFromEnv = optional("CLIENT_DIST_PATH", "").trim();
const clientDistPathResolved =
  clientDistFromEnv ||
  (fs.existsSync(defaultClientDist) ? defaultClientDist : "");

export const env = {
  nodeEnv: optional("NODE_ENV", "development"),
  port: intEnv("PORT", 3000),
  logLevel: optional("LOG_LEVEL", "info"),
  databaseUrl: required("DATABASE_URL"),
  mnemonic: required("MNEMONIC"),
  jwtSecret: required("JWT_SECRET"),
  clientOrigins: listEnv(
    "CLIENT_ORIGINS",
    "https://portal.cryptovapay.com",
  ).map(normalizeBrowserOrigin),
  encryptionKey: optional("ENCRYPTION_KEY"),

  /** Base URL of the browser app (for password-reset links), e.g. https://portal.example.com */
  appPublicUrl: optional("APP_PUBLIC_URL", "https://portal.cryptovapay.com"),
  /** Optional origin for `/pay/…` links; defaults to `APP_PUBLIC_URL` when unset. */
  paymentPagePublicUrl: optional("PAYMENT_PAGE_PUBLIC_URL", ""),
  passwordResetTtlMinutes: intEnv("PASSWORD_RESET_TTL_MINUTES", 60),

  smtpHost: optional("SMTP_HOST"),
  smtpPort: intEnv("SMTP_PORT", 587),
  smtpSecure: optional("SMTP_SECURE", "false") === "true",
  smtpUser: optional("SMTP_USER"),
  smtpPass: optional("SMTP_PASS"),
  smtpFrom: optional("SMTP_FROM", "noreply@localhost"),

  confirmationsEvm: intEnv("CONFIRMATIONS_EVM", 12),
  confirmationsTron: intEnv("CONFIRMATIONS_TRON", 20),
  confirmationsBtc: intEnv("CONFIRMATIONS_BTC", 3),
  confirmationsTon: intEnv("CONFIRMATIONS_TON", 2),
  confirmationsSolana: intEnv("CONFIRMATIONS_SOLANA", 1),

  workerPollMs: intEnv("WORKER_POLL_INTERVAL_MS", 8000),
  /** `0` = no assign TTL (`scan_expires_at` null); hot-path scan uses tx rows, one-shot, or full-scan cron. */
  walletScanTtlMinutes: intEnv("WALLET_SCAN_TTL_MINUTES", 10),
  /**
   * How long a deposit address stays reserved for one end-user (minutes). Then it re-enters the merchant pool if unpaid.
   * `0` = reserve until payment success only (no time-based release).
   */
  walletAssignmentHoldMinutes: intEnv("WALLET_ASSIGNMENT_HOLD_MINUTES", 10),
  /**
   * Maintenance cron (`crypto-gateway-cron-maintenance`): how often to clear expired pooled-wallet holds (minutes).
   * Clamped to 1–59 for the minute field (every N minutes in node-cron). Tunable in Admin → System settings.
   */
  walletPoolHoldReleaseCronMinutes: intEnv(
    "WALLET_POOL_HOLD_RELEASE_CRON_MINUTES",
    30,
  ),
  /** Legacy env; worker no longer runs late-deposit recheck (use full-scan interval + TTL + rescan). */
  lateDepositRecheckHours: intEnv("LATE_DEPOSIT_RECHECK_HOURS", 6),
  /**
   * Maintenance cron: run one full deposit scan pass across all live wallets every N hours (`0` = off).
   * Admin / `app_settings` can override (`DEPOSIT_FULL_SCAN_INTERVAL_HOURS`).
   */
  depositFullScanIntervalHours: intEnv("DEPOSIT_FULL_SCAN_INTERVAL_HOURS", 6),
  /**
   * Per worker tick: log counts of **new** `transactions` rows inserted, by deposit rail (CURRENCY|NETWORK),
   * plus **which on-chain addresses** were polled for incoming tx (see `polled_addresses_by_chain` / `message`).
   * `nonzero` — log only when at least one new row this tick. `always` — every tick (includes zeros).
   * `off` — disable (no extra findUnique per scanned tx).
   */
  workerLogRailCounts: optional("WORKER_LOG_RAIL_COUNTS", "always"),
  /**
   * When true (default), PM2 `crypto-gateway-worker` deposit scanner runs **TRON only** (native + TRC20 such as USDT).
   * Set `DEPOSIT_SCANNER_TRON_ONLY=false` to scan EVM (ETH/BNB) and TON on each tick again.
   */
  depositScannerTronOnly: (() => {
    const v = optional("DEPOSIT_SCANNER_TRON_ONLY", "true").toLowerCase();
    return v !== "false" && v !== "0";
  })(),

  rpcEth: required("RPC_ETH"),
  rpcBnb: required("RPC_BNB"),
  rpcPolygon: required("RPC_POLYGON"),
  rpcArbitrum: required("RPC_ARBITRUM"),
  rpcOptimism: required("RPC_OPTIMISM"),

  tronFullNode: optional("TRON_FULL_NODE", "https://api.trongrid.io"),
  /** TronScan HTTP API base (deposit tracker). Docs: https://docs.tronscan.org */
  tronscanApiBase: optional("TRONSCAN_API_BASE", "https://apilist.tronscanapi.com"),
  /**
   * TronScan `TRON-PRO-API-KEY` (deposit worker). Optional in .env if you store it in Admin → System settings
   * (`app_settings.TRONSCAN_API_KEY`); non-empty DB value overrides this env var after `loadAppSettingsFromDatabase`.
   * For per-address TronScan logs in PM2 (`tronscan_*` events), keep `LOG_LEVEL` at `info` (default) or lower.
   */
  tronscanApiKey: optional("TRONSCAN_API_KEY", ""),
  tronSolidityNode: optional("TRON_SOLIDITY_NODE", "https://api.trongrid.io"),
  tronEventServer: optional("TRON_EVENT_SERVER", "https://api.trongrid.io"),
  tronApiKey: optional("TRON_API_KEY"),

  tonApiBase: optional("TON_API_BASE", "https://tonapi.io"),
  tonApiKey: optional("TON_API_KEY"),

  btcExplorerApiBase: optional(
    "BTC_EXPLORER_API_BASE",
    "https://mempool.space/api",
  ),

  sweepMasterEvm: optional("SWEEP_MASTER_EVM"),
  sweepMasterTron: optional("SWEEP_MASTER_TRON"),
  /** Native TRX on TRON; if unset, TRX sweep uses `SWEEP_MASTER_TRON` (same T address). */
  sweepMasterTrx: optional("SWEEP_MASTER_TRX"),
  /** ERC20 USDT (Ethereum) consolidation destination. */
  sweepMasterUsdtEth: optional("SWEEP_MASTER_USDT_ETH"),
  /** BEP20 USDT (BNB Chain) consolidation destination. */
  sweepMasterUsdtBnb: optional("SWEEP_MASTER_USDT_BNB"),
  sweepMasterBtc: optional("SWEEP_MASTER_BTC"),
  sweepMasterSolana: optional("SWEEP_MASTER_SOLANA"),

  /**
   * Hex private key (no 0x prefix ok) for a hot wallet that sends **native TRX** to deposit addresses
   * when automated USDT·TRC20 sweep needs fee bandwidth. Must match funds on-chain.
   */
  sweepTrxFunderPrivateKey: optional("SWEEP_TRX_FUNDER_PRIVATE_KEY"),
  /** Optional: expected base58 TRX address for the funder key (sanity check vs derived address). */
  sweepTrxFunderAddress: optional("SWEEP_TRX_FUNDER_ADDRESS"),
  /**
   * Legacy setting (still in Admin DB for compatibility). Automated USDT sweep now sizes TRX top-ups from
   * `estimateEnergy` + account resources; this value is not applied to top-up amount.
   * @type {bigint}
   */
  sweepTrxTopupSun: (() => {
    const n = intEnv("SWEEP_TRX_TOPUP_SUN", 15_000_000);
    return BigInt(Math.max(1, n));
  })(),
  /**
   * Minimum USDT balance (atomic units, 6 decimals) for automated sweep. Default 1_000_000 = 1 USDT.
   * `.env` keeps this as atomic; Admin System settings edits the same key as a USDT amount (e.g. `1`).
   * @type {bigint}
   */
  sweepTronUsdtMinAtomic: (() => {
    const raw = process.env.SWEEP_TRON_USDT_MIN_ATOMIC?.trim();
    if (!raw) return 1_000_000n;
    try {
      return BigInt(raw);
    } catch {
      return 1_000_000n;
    }
  })(),
  /** When true, PM2 `crypto-gateway-cron-tron-sweep` runs TRON USDT auto-sweep on schedule. */
  sweepTronAutoCronEnabled:
    optional("SWEEP_TRON_AUTO_CRON_ENABLED", "false").toLowerCase() === "true",
  /** Minutes between automated TRON USDT sweep cron ticks (default 30). */
  sweepTronAutoCronMinutes: intEnv("SWEEP_TRON_AUTO_CRON_MINUTES", 30),

  /** Solana JSON RPC (mainnet-beta by default). */
  solanaRpcUrl: optional("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com"),
  /** SPL USDT mint (mainnet default). */
  solanaUsdtMint: optional(
    "SOLANA_USDT_MINT",
    "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  ),

  /**
   * When true, allows POST /sandbox/simulate-deposit with the **live** API key too
   * (local dev only). Merchants should use their sandbox API key instead.
   */
  gatewaySandbox: optional("GATEWAY_SANDBOX", "false").toLowerCase() === "true",

  /**
   * When true (default), the gateway only accepts USDT on TRC20; other rails stay in code but are rejected.
   * Set `GATEWAY_TRON_USDT_ONLY=false` or `0` to allow all configured rails again.
   */
  gatewayTronUsdtOnly: (() => {
    const v = optional("GATEWAY_TRON_USDT_ONLY", "true").toLowerCase();
    return v !== "false" && v !== "0";
  })(),

  /**
   * Max outbound RPC / explorer HTTP calls per rolling 1s **per network bucket** (EVM_ETH, TRON, …).
   * `0` = disable limiting. Requests wait (queue) instead of returning errors to integrators.
   */
  outboundRpcMaxPerSecond: intEnv("OUTBOUND_RPC_MAX_PER_SECOND", 125),

  /**
   * Absolute or cwd-relative path to Vite `client/dist`. If unset, uses monorepo `client/dist` when it exists.
   * When set and the folder exists, Express serves the SPA and `GET /` is the React app (not JSON).
   */
  clientDistPath: clientDistPathResolved,
};

export function parseJsonEnv(raw, fallback) {
  if (!raw?.trim()) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export {
  getErc20Contracts,
  getTrc20Contracts,
  getTonJettonContracts,
} from "./runtime-contracts.js";
