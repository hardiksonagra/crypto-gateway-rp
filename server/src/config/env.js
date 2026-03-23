import dotenv from "dotenv";
import path from "path";

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

export const env = {
  nodeEnv: optional("NODE_ENV", "development"),
  port: intEnv("PORT", 3000),
  logLevel: optional("LOG_LEVEL", "info"),
  databaseUrl: required("DATABASE_URL"),
  mnemonic: required("MNEMONIC"),
  jwtSecret: required("JWT_SECRET"),
  clientOrigins: listEnv(
    "CLIENT_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000",
  ),
  encryptionKey: optional("ENCRYPTION_KEY"),

  confirmationsEvm: intEnv("CONFIRMATIONS_EVM", 12),
  confirmationsTron: intEnv("CONFIRMATIONS_TRON", 20),
  confirmationsBtc: intEnv("CONFIRMATIONS_BTC", 3),
  confirmationsTon: intEnv("CONFIRMATIONS_TON", 2),

  workerPollMs: intEnv("WORKER_POLL_INTERVAL_MS", 8000),

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
  sweepMasterBtc: optional("SWEEP_MASTER_BTC"),
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
