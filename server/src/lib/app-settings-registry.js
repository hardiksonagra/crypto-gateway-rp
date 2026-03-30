/**
 * Admin-editable settings: DB row overrides process env when present.
 * Bootstrap secrets (DATABASE_URL, MNEMONIC, JWT_SECRET, ENCRYPTION_KEY, funder private key) stay env-only.
 *
 * @typedef {{ key: string, label: string, category: string, type: "string" | "int" | "bool" | "bool_tron_gateway" | "bigint" | "json" | "comma_origins", sensitive?: boolean }} AppSettingDef
 */

/** @type {AppSettingDef[]} */
export const APP_SETTING_DEFINITIONS = [
  {
    key: "LOG_LEVEL",
    label: "Log level",
    category: "General",
    type: "string",
  },
  {
    key: "CLIENT_ORIGINS",
    label: "Allowed browser origins (comma-separated)",
    category: "General",
    type: "comma_origins",
  },
  {
    key: "APP_PUBLIC_URL",
    label: "Portal base URL (password reset links)",
    category: "General",
    type: "string",
  },
  {
    key: "PAYMENT_PAGE_PUBLIC_URL",
    label: "Payment page public URL (optional)",
    category: "General",
    type: "string",
  },
  {
    key: "PASSWORD_RESET_TTL_MINUTES",
    label: "Password reset link TTL (minutes)",
    category: "General",
    type: "int",
  },

  {
    key: "SMTP_HOST",
    label: "SMTP host",
    category: "Email",
    type: "string",
  },
  {
    key: "SMTP_PORT",
    label: "SMTP port",
    category: "Email",
    type: "int",
  },
  {
    key: "SMTP_SECURE",
    label: "SMTP TLS (true/false)",
    category: "Email",
    type: "bool",
  },
  {
    key: "SMTP_USER",
    label: "SMTP username",
    category: "Email",
    type: "string",
  },
  {
    key: "SMTP_PASS",
    label: "SMTP password",
    category: "Email",
    type: "string",
    sensitive: true,
  },
  {
    key: "SMTP_FROM",
    label: "SMTP From",
    category: "Email",
    type: "string",
  },

  {
    key: "CONFIRMATIONS_EVM",
    label: "EVM confirmations",
    category: "Confirmations",
    type: "int",
  },
  {
    key: "CONFIRMATIONS_TRON",
    label: "TRON confirmations",
    category: "Confirmations",
    type: "int",
  },
  {
    key: "CONFIRMATIONS_BTC",
    label: "BTC confirmations",
    category: "Confirmations",
    type: "int",
  },
  {
    key: "CONFIRMATIONS_TON",
    label: "TON confirmations",
    category: "Confirmations",
    type: "int",
  },
  {
    key: "CONFIRMATIONS_SOLANA",
    label: "Solana confirmations",
    category: "Confirmations",
    type: "int",
  },

  {
    key: "WORKER_POLL_INTERVAL_MS",
    label: "Deposit scanner poll interval (ms)",
    category: "Scanner / worker",
    type: "int",
  },
  {
    key: "WALLET_SCAN_TTL_MINUTES",
    label: "Wallet scan TTL (minutes, 0 = none)",
    category: "Scanner / worker",
    type: "int",
  },
  {
    key: "WALLET_ASSIGNMENT_HOLD_MINUTES",
    label: "Pooled address hold (minutes, 0 = until paid)",
    category: "Scanner / worker",
    type: "int",
  },
  {
    key: "LATE_DEPOSIT_RECHECK_HOURS",
    label: "Late deposit recheck (hours, 0 = off)",
    category: "Scanner / worker",
    type: "int",
  },
  {
    key: "WORKER_LOG_RAIL_COUNTS",
    label: "Worker rail count logs (off / nonzero / always)",
    category: "Scanner / worker",
    type: "string",
  },
  {
    key: "DEPOSIT_SCANNER_TRON_ONLY",
    label: "Deposit scanner: TRON only (skip EVM + TON ticks)",
    category: "Scanner / worker",
    type: "bool",
  },

  {
    key: "RPC_ETH",
    label: "RPC · Ethereum",
    category: "EVM RPC",
    type: "string",
  },
  {
    key: "RPC_BNB",
    label: "RPC · BNB Chain",
    category: "EVM RPC",
    type: "string",
  },
  {
    key: "RPC_POLYGON",
    label: "RPC · Polygon",
    category: "EVM RPC",
    type: "string",
  },
  {
    key: "RPC_ARBITRUM",
    label: "RPC · Arbitrum",
    category: "EVM RPC",
    type: "string",
  },
  {
    key: "RPC_OPTIMISM",
    label: "RPC · Optimism",
    category: "EVM RPC",
    type: "string",
  },

  {
    key: "TRON_FULL_NODE",
    label: "TRON full node URL",
    category: "TRON",
    type: "string",
  },
  {
    key: "TRONSCAN_API_BASE",
    label: "TronScan API base URL (deposit tracker)",
    category: "TRON",
    type: "string",
  },
  {
    key: "TRONSCAN_API_KEY",
    label: "TronScan API key (TRON-PRO-API-KEY header for tracker)",
    category: "TRON",
    type: "string",
    sensitive: true,
  },
  {
    key: "TRON_SOLIDITY_NODE",
    label: "TRON solidity node URL",
    category: "TRON",
    type: "string",
  },
  {
    key: "TRON_EVENT_SERVER",
    label: "TRON event server URL",
    category: "TRON",
    type: "string",
  },
  {
    key: "TRON_API_KEY",
    label: "TRON API key (e.g. TronGrid)",
    category: "TRON",
    type: "string",
    sensitive: true,
  },

  {
    key: "TON_API_BASE",
    label: "TON API base URL",
    category: "TON",
    type: "string",
  },
  {
    key: "TON_API_KEY",
    label: "TON API key",
    category: "TON",
    type: "string",
    sensitive: true,
  },

  {
    key: "BTC_EXPLORER_API_BASE",
    label: "BTC explorer API base",
    category: "Bitcoin",
    type: "string",
  },

  {
    key: "SWEEP_MASTER_EVM",
    label: "Sweep master · native EVM",
    category: "Sweep addresses",
    type: "string",
  },
  {
    key: "SWEEP_MASTER_TRON",
    label: "Sweep master · TRON (USDT/TRC20)",
    category: "Sweep addresses",
    type: "string",
  },
  {
    key: "SWEEP_MASTER_TRX",
    label: "Sweep master · native TRX (optional)",
    category: "Sweep addresses",
    type: "string",
  },
  {
    key: "SWEEP_MASTER_USDT_ETH",
    label: "Sweep master · USDT ERC20",
    category: "Sweep addresses",
    type: "string",
  },
  {
    key: "SWEEP_MASTER_USDT_BNB",
    label: "Sweep master · USDT BEP20",
    category: "Sweep addresses",
    type: "string",
  },
  {
    key: "SWEEP_MASTER_BTC",
    label: "Sweep master · BTC",
    category: "Sweep addresses",
    type: "string",
  },
  {
    key: "SWEEP_MASTER_SOLANA",
    label: "Sweep master · Solana",
    category: "Sweep addresses",
    type: "string",
  },
  {
    key: "SWEEP_TRX_FUNDER_ADDRESS",
    label: "TRX funder address (sanity check)",
    category: "Sweep · TRON auto",
    type: "string",
  },
  {
    key: "SWEEP_TRX_TOPUP_SUN",
    label: "TRX top-up base (sun)",
    category: "Sweep · TRON auto",
    type: "bigint",
  },
  {
    key: "SWEEP_TRON_USDT_MIN_ATOMIC",
    label: "Min USDT (atomic, 6 decimals) for auto-sweep",
    category: "Sweep · TRON auto",
    type: "bigint",
  },
  {
    key: "SWEEP_TRON_AUTO_CRON_ENABLED",
    label: "Enable TRON USDT auto-sweep cron",
    category: "Sweep · TRON auto",
    type: "bool",
  },
  {
    key: "SWEEP_TRON_AUTO_CRON_MINUTES",
    label: "TRON USDT auto-sweep interval (minutes)",
    category: "Sweep · TRON auto",
    type: "int",
  },

  {
    key: "SOLANA_RPC_URL",
    label: "Solana JSON RPC",
    category: "Solana",
    type: "string",
  },
  {
    key: "SOLANA_USDT_MINT",
    label: "SPL USDT mint",
    category: "Solana",
    type: "string",
  },

  {
    key: "GATEWAY_SANDBOX",
    label: "Allow live API key for sandbox simulate-deposit",
    category: "Gateway",
    type: "bool",
  },
  {
    key: "GATEWAY_TRON_USDT_ONLY",
    label: "Gateway TRON·USDT only mode",
    category: "Gateway",
    type: "bool_tron_gateway",
  },

  {
    key: "OUTBOUND_RPC_MAX_PER_SECOND",
    label: "Outbound RPC max per second (0 = off)",
    category: "Rate limits",
    type: "int",
  },

  {
    key: "ERC20_CONTRACTS",
    label: "ERC20 contract map (JSON)",
    category: "Contract maps",
    type: "json",
  },
  {
    key: "TRC20_CONTRACTS",
    label: "TRC20 contract map (JSON)",
    category: "Contract maps",
    type: "json",
  },
  {
    key: "TON_JETTON_CONTRACTS",
    label: "TON jetton map (JSON)",
    category: "Contract maps",
    type: "json",
  },
];

/** @type {Map<string, AppSettingDef>} */
export const APP_SETTING_DEF_BY_KEY = new Map(
  APP_SETTING_DEFINITIONS.map((d) => [d.key, d]),
);
