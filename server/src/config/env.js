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
  /** `0` = no TTL; new wallets get `scan_expires_at` null (always scanned). */
  walletScanTtlMinutes: intEnv("WALLET_SCAN_TTL_MINUTES", 10),
  /**
   * Re-scan expired, zero-tx live wallets on TRON/TON/BTC (address APIs). `0` = off.
   * EVM chains are skipped (forward block cursor cannot recover old missed transfers).
   */
  lateDepositRecheckHours: intEnv("LATE_DEPOSIT_RECHECK_HOURS", 6),
  /**
   * Per worker tick: log counts of **new** `transactions` rows inserted, by deposit rail (CURRENCY|NETWORK).
   * `nonzero` — log only when at least one new row this tick. `always` — every tick (includes zeros).
   * `off` — disable (no extra findUnique per scanned tx).
   */
  workerLogRailCounts: optional("WORKER_LOG_RAIL_COUNTS", "always"),

  rpcEth: required("RPC_ETH"),
  rpcBnb: required("RPC_BNB"),
  rpcPolygon: required("RPC_POLYGON"),
  rpcArbitrum: required("RPC_ARBITRUM"),
  rpcOptimism: required("RPC_OPTIMISM"),

  tronFullNode: optional("TRON_FULL_NODE", "https://api.trongrid.io"),
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
  outboundRpcMaxPerSecond: intEnv("OUTBOUND_RPC_MAX_PER_SECOND", 5),

  /**
   * Absolute or cwd-relative path to Vite `client/dist`. If unset, uses monorepo `client/dist` when it exists.
   * When set and the folder exists, Express serves the SPA and `GET /` is the React app (not JSON).
   */
  clientDistPath: clientDistPathResolved,

  /**
   * When `false`, `src/index.js` does not start the blockchain worker — run `src/worker-entry.js` under PM2 separately.
   */
  runInlineBlockchainWorker:
    optional("RUN_BLOCKCHAIN_WORKER", "true").toLowerCase() !== "false",
};

export function parseJsonEnv(raw, fallback) {
  if (!raw?.trim()) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function getErc20Contracts() {
  return parseJsonEnv(optional("ERC20_CONTRACTS", "{}"), {});
}

const DEFAULT_TRC20_USDT = {
  TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t: { symbol: "USDT", decimals: 6 },
};

export function getTrc20Contracts() {
  const fromEnv = parseJsonEnv(optional("TRC20_CONTRACTS", "{}"), {});
  return { ...DEFAULT_TRC20_USDT, ...fromEnv };
}

const DEFAULT_TON_JETTON_USDT = {
  EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs: {
    symbol: "USDT",
    decimals: 6,
  },
  "0:b113a994b5024a16719f69139328eb759596c38a25f59028b146fecdc3621dfe": {
    symbol: "USDT",
    decimals: 6,
  },
};

export function getTonJettonContracts() {
  const fromEnv = parseJsonEnv(optional("TON_JETTON_CONTRACTS", "{}"), {});
  return { ...DEFAULT_TON_JETTON_USDT, ...fromEnv };
}
