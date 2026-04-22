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

/**
 * BIP39 phrase: trim, strip BOM / zero-width chars, NBSP → space, collapse
 * whitespace, lowercase. Prevents `invalid mnemonic word at index 0` when
 * the first “word” is actually `\uFEFFabandon` from a UTF-8 BOM on the line.
 * @returns {string}
 */
function loadNormalizedMnemonic() {
  const raw = process.env.MNEMONIC;
  if (!raw?.trim()) throw new Error("Missing required env: MNEMONIC");
  return String(raw)
    .trim()
    .replace(/^\uFEFF/, "")
    .replace(/\uFEFF/g, "")
    .replace(/\u200B/g, "")
    .replace(/\u00a0/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
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
  mnemonic: loadNormalizedMnemonic(),
  jwtSecret: required("JWT_SECRET"),
  /** Portal JWT lifetime (e.g. `24h`, `7d`). `jsonwebtoken` `expiresIn` string. */
  jwtExpiresIn: optional("JWT_EXPIRES_IN", "7d"),
  clientOrigins: listEnv(
    "CLIENT_ORIGINS",
    "https://portal.cryptovapay.com",
  ).map(normalizeBrowserOrigin),
  /**
   * Emergency only: reflect any `Origin` (disables the CORS allow-list). Not read from Admin DB.
   * Prefer fixing `CLIENT_ORIGINS` + `APP_PUBLIC_URL` (and `www` vs apex) instead.
   */
  corsAllowAll: (() => {
    const v = optional("CORS_ALLOW_ALL", "").toLowerCase();
    return v === "true" || v === "1" || v === "yes";
  })(),
  /**
   * If set (e.g. `example.com`), allow any browser Origin whose hostname is that host or a subdomain of it.
   * Use when portal + pay + other SPAs share one domain (portal.example.com, pay.example.com). Not from Admin DB.
   */
  corsAllowedOriginSuffix: optional("CORS_ALLOWED_ORIGIN_SUFFIX", "")
    .trim()
    .toLowerCase()
    .replace(/^\./, ""),
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

  /**
   * USDT·ERC20 deposit worker poll interval (ms) after resolving env.
   * Prefer `WORKER_POLL_INTERVAL_SEC_ERC20` (seconds); else legacy `WORKER_POLL_INTERVAL_MS_ERC20` / `WORKER_POLL_INTERVAL_MS`.
   * Admin / DB: `WORKER_POLL_INTERVAL_SEC_ERC20` (seconds).
   */
  workerPollMsErc20: (() => {
    const sec = intEnv("WORKER_POLL_INTERVAL_SEC_ERC20", 0);
    if (sec >= 1) return Math.max(1000, sec * 1000);
    const ms = intEnv(
      "WORKER_POLL_INTERVAL_MS_ERC20",
      intEnv("WORKER_POLL_INTERVAL_MS", 8000),
    );
    return ms >= 1000 ? ms : 1000;
  })(),
  /**
   * USDT·TRC20 deposit worker poll interval (ms) after resolving env.
   * Prefer `WORKER_POLL_INTERVAL_SEC_TRC20`; else legacy MS env vars (same pattern as ERC20).
   * Admin / DB: `WORKER_POLL_INTERVAL_SEC_TRC20` (seconds).
   */
  workerPollMsTrc20: (() => {
    const sec = intEnv("WORKER_POLL_INTERVAL_SEC_TRC20", 0);
    if (sec >= 1) return Math.max(1000, sec * 1000);
    const ms = intEnv(
      "WORKER_POLL_INTERVAL_MS_TRC20",
      intEnv("WORKER_POLL_INTERVAL_MS", 8000),
    );
    return ms >= 1000 ? ms : 1000;
  })(),
  /**
   * ERC20 deposit scanner: max Ethereum blocks per worker tick (each block = Etherscan getLogs, sequential).
   * Lower = shorter `tick_duration_ms` per tick; higher = faster catch-up behind chain tip. Admin: `EVM_DEPOSIT_SCAN_MAX_BLOCKS_PER_TICK`.
   */
  evmDepositScanMaxBlocksPerTick: (() => {
    const primary = intEnv("EVM_DEPOSIT_SCAN_MAX_BLOCKS_PER_TICK", 0);
    if (primary >= 1) return Math.min(50, primary);
    const legacy = intEnv("EVM_SCAN_MAX_BLOCKS_PER_TICK", 4);
    return Math.min(50, Math.max(1, legacy));
  })(),
  /** See `resolvedWalletScanTtlMinutes` in app-settings-runtime (Admin → env → default 10). */
  walletScanTtlMinutes: intEnv("WALLET_SCAN_TTL_MINUTES", 10),
  /** See `resolvedWalletAssignmentHoldMinutes` in app-settings-runtime (Admin → env → default 30). */
  walletAssignmentHoldMinutes: intEnv("WALLET_ASSIGNMENT_HOLD_MINUTES", 30),
  /**
   * Maintenance cron (`crypto-gateway-cron-maintenance`): how often to clear expired pooled-wallet holds (minutes).
   * Clamped to 1–59 for the minute field (every N minutes in node-cron). Tunable in Admin → System settings.
   */
  walletPoolHoldReleaseCronMinutes: intEnv(
    "WALLET_POOL_HOLD_RELEASE_CRON_MINUTES",
    30,
  ),
  /**
   * Maintenance cron: `created` checkout placeholder rows older than this many hours are set to `failed`
   * and a payment webhook is sent (`status: failed`, `failure_reason: checkout_expired_unpaid`).
   */
  checkoutCreatedExpiryHours: intEnv("CHECKOUT_CREATED_EXPIRY_HOURS", 24),
  /**
   * How often the maintenance cron runs the stale-checkout pass (minutes, 1–59).
   */
  checkoutExpiryCronMinutes: intEnv("CHECKOUT_EXPIRY_CRON_MINUTES", 30),
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
   * When true (default), the **ERC20** deposit worker only loads Ethereum wallets when at least one exists (lighter).
   * Set `DEPOSIT_SCANNER_TRON_ONLY=false` to run the full ETH block walk each ERC20 tick. TRON is scanned by the TRC20 worker process.
   */
  depositScannerTronOnly: (() => {
    const v = optional("DEPOSIT_SCANNER_TRON_ONLY", "true").toLowerCase();
    return v !== "false" && v !== "0";
  })(),

  /**
   * JSON map `Chain` → boolean (false disables that chain platform-wide). Prefer Admin → Supported chains.
   * Empty `{}` or missing DB row = all chains enabled.
   */
  chainEnabledJson: optional("CHAIN_ENABLED", "{}"),

  /**
   * Ethereum JSON-RPC URL — **optional** if you only use TronScan + Etherscan for deposits/balances.
   * Required for **USDT·ERC20 consolidate sweep** (broadcast + gas) and any code that sends native ETH txs.
   */
  rpcEth: optional("RPC_ETH", ""),

  /**
   * Etherscan HTTP API v2 base (same pattern as `TRONSCAN_API_BASE`). **USDT·ERC20 deposit scan** and admin
   * ERC20 balance refresh use this + `ETHERSCAN_API_KEY` only (no `RPC_ETH`). Docs: https://docs.etherscan.io/
   */
  etherscanApiBase: optional(
    "ETHERSCAN_API_BASE",
    "https://api.etherscan.io/v2/api",
  ),
  /**
   * Etherscan API key (same pattern as `TRONSCAN_API_KEY`): optional in .env if you store it in Admin → System settings
   * (`app_settings.ETHERSCAN_API_KEY`); non-empty DB value overrides this env var after `loadAppSettingsFromDatabase`.
   * Create a key at https://etherscan.io/apidashboard — use a v2 key for `chainid` 1 (Ethereum mainnet).
   */
  etherscanApiKey: optional("ETHERSCAN_API_KEY", ""),

  tronFullNode: optional("TRON_FULL_NODE", "https://api.trongrid.io"),
  /** TronScan HTTP API base (deposit tracker). Docs: https://docs.tronscan.org */
  tronscanApiBase: optional(
    "TRONSCAN_API_BASE",
    "https://apilist.tronscanapi.com",
  ),
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
  /** ERC20 USDT (Ethereum) consolidation destination. */
  sweepMasterUsdtEth: optional("SWEEP_MASTER_USDT_ETH"),
  sweepMasterBtc: optional("SWEEP_MASTER_BTC"),

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
   * Deposit scanner only (Etherscan getLogs / eth_blockNumber): max HTTP calls per rolling 1s, all EVM chains share one bucket.
   * `0` = use only `OUTBOUND_RPC_MAX_PER_SECOND` for those calls. Admin: `DEPOSIT_SCANNER_API_MAX_PER_SECOND_ERC20`.
   */
  depositScannerApiMaxPerSecondErc20: intEnv(
    "DEPOSIT_SCANNER_API_MAX_PER_SECOND_ERC20",
    0,
  ),
  /**
   * Deposit scanner only (TronScan token transfers): max HTTP calls per rolling 1s for TRC20 tick.
   * `0` = use only `OUTBOUND_RPC_MAX_PER_SECOND`. Admin: `DEPOSIT_SCANNER_API_MAX_PER_SECOND_TRC20`.
   */
  depositScannerApiMaxPerSecondTrc20: intEnv(
    "DEPOSIT_SCANNER_API_MAX_PER_SECOND_TRC20",
    0,
  ),

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
