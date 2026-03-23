import "dotenv/config";

/**
 * Central typed configuration loaded from environment.
 * Architecture: all secrets and RPC endpoints live here; workers and HTTP share one source of truth.
 */
function required(name: string): string {
  const v = process.env[name];
  if (!v?.trim()) throw new Error(`Missing required env: ${name}`);
  return v.trim();
}

function optional(name: string, fallback = ""): string {
  return process.env[name]?.trim() ?? fallback;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const env = {
  nodeEnv: optional("NODE_ENV", "development"),
  port: intEnv("PORT", 3000),
  logLevel: optional("LOG_LEVEL", "info"),
  databaseUrl: required("DATABASE_URL"),
  mnemonic: required("MNEMONIC"),
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
} as const;

export type Erc20Config = Record<string, { symbol: string; decimals: number }>;
export type Erc20ByChain = Partial<Record<string, Erc20Config>>;

export function parseJsonEnv<T>(raw: string, fallback: T): T {
  if (!raw?.trim()) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function getErc20Contracts(): Erc20ByChain {
  return parseJsonEnv<Erc20ByChain>(optional("ERC20_CONTRACTS", "{}"), {});
}

/** Mainnet USDT (TRC-20); merged so deposits work without an empty `TRC20_CONTRACTS`. */
const DEFAULT_TRC20_USDT: Erc20Config = {
  TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t: { symbol: "USDT", decimals: 6 },
};

export function getTrc20Contracts(): Erc20Config {
  const fromEnv = parseJsonEnv<Erc20Config>(optional("TRC20_CONTRACTS", "{}"), {});
  return { ...DEFAULT_TRC20_USDT, ...fromEnv };
}

/** Official USDT jetton on TON mainnet (TEP-74). Keys: friendly or raw `0:…`. */
const DEFAULT_TON_JETTON_USDT: Erc20Config = {
  EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs: { symbol: "USDT", decimals: 6 },
  "0:b113a994b5024a16719f69139328eb759596c38a25f59028b146fecdc3621dfe": {
    symbol: "USDT",
    decimals: 6,
  },
};

export function getTonJettonContracts(): Erc20Config {
  const fromEnv = parseJsonEnv<Erc20Config>(optional("TON_JETTON_CONTRACTS", "{}"), {});
  return { ...DEFAULT_TON_JETTON_USDT, ...fromEnv };
}
