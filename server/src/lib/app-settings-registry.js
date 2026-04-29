/**
 * Admin-editable settings: DB row overrides process env when present.
 * Bootstrap secrets (DATABASE_URL, MNEMONIC, JWT_SECRET, ENCRYPTION_KEY, funder private key) stay env-only.
 *
 * @typedef {{ key: string, label: string, category: string, type: "string" | "int" | "bool" | "bool_tron_gateway" | "bigint" | "usdt6" | "json" | "comma_origins", sensitive?: boolean, hideFromAdminList?: boolean, helpText?: string }} AppSettingDef
 */

/**
 * System settings **section titles** for deposit scanning (Admin UI groups by `category`).
 * Convention: `Deposit scanner · shared` = all rails; `Deposit scanner · USDT·<network>` = one PM2 rail.
 * When adding a new deposit rail: add a key here, add `WORKER_POLL_INTERVAL_SEC_*` (or rail-specific keys),
 * wire `re` / `env` / `envFallbackString`, add PM2 app + `cron/src/entry-worker-*.js`, and append defs under the new category (keep this block ordered: shared → ERC20 → TRC20 → future rails alphabetically by label).
 */
export const DEPOSIT_SCANNER_CATEGORIES = {
  shared: "Deposit scanner · shared",
  usdtErc20: "Deposit scanner · USDT·ERC20",
  usdtTrc20: "Deposit scanner · USDT·TRC20",
};

/** Fixed-amount checkout expiry (maintenance cron + `server/src/services/checkout-session-expiry.js`). */
export const CHECKOUT_SETTINGS_CATEGORY = "Checkout · abandoned fixed-amount";

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
    key: "WALLET_SCAN_TTL_MINUTES",
    label:
      "Wallet scan TTL (minutes). Empty / 0 / invalid here → .env; same there → default 10",
    category: DEPOSIT_SCANNER_CATEGORIES.shared,
    type: "int",
  },
  {
    key: "WALLET_ASSIGNMENT_HOLD_MINUTES",
    label:
      "Pooled address hold (minutes). Empty / 0 / invalid here → .env; same there → default 30",
    category: DEPOSIT_SCANNER_CATEGORIES.shared,
    type: "int",
  },
  {
    key: "WALLET_POOL_HOLD_RELEASE_CRON_MINUTES",
    label: "Wallet pool hold release cron interval (minutes, 1–59)",
    category: DEPOSIT_SCANNER_CATEGORIES.shared,
    type: "int",
  },
  {
    key: "CHECKOUT_CREATED_EXPIRY_HOURS",
    label:
      "Unpaid checkout → failed after N hours (1–8760); payment webhook checkout_expired_unpaid",
    helpText:
      "Applies to gateway-created placeholders (status created, or stuck pending with amount 0). After N hours the row becomes failed and the wallet is released. Real on-chain pending deposits are not expired here. Same as env CHECKOUT_CREATED_EXPIRY_HOURS; Admin value overrides .env when set.",
    category: CHECKOUT_SETTINGS_CATEGORY,
    type: "int",
  },
  {
    key: "CHECKOUT_EXPIRY_CRON_MINUTES",
    label:
      "Run stale-checkout pass every N minutes (1–59); PM2 crypto-gateway-cron-maintenance (restart to apply)",
    helpText:
      "How often maintenance cron looks for checkouts past the hours threshold above. Restart the maintenance PM2 app after changing this.",
    category: CHECKOUT_SETTINGS_CATEGORY,
    type: "int",
  },
  {
    key: "LATE_DEPOSIT_RECHECK_HOURS",
    label:
      "Legacy: no longer used by worker (use DEPOSIT_FULL_SCAN_INTERVAL_HOURS + wallet TTL + rescan).",
    category: DEPOSIT_SCANNER_CATEGORIES.shared,
    type: "int",
  },
  {
    key: "DEPOSIT_FULL_SCAN_INTERVAL_HOURS",
    label:
      "Full live-wallet deposit scan (hours, 0 = off). Runs once per interval from maintenance cron.",
    category: DEPOSIT_SCANNER_CATEGORIES.shared,
    type: "int",
  },
  {
    key: "WORKER_LOG_RAIL_COUNTS",
    label:
      "Deposit tick logs: rail counts + polled addresses (off / nonzero / always)",
    category: DEPOSIT_SCANNER_CATEGORIES.shared,
    type: "string",
  },

  {
    key: "WORKER_POLL_INTERVAL_SEC_ERC20",
    label:
      "Timer between ticks (seconds, min 1) — PM2 `crypto-gateway-worker-erc20`; each tick can take longer (Etherscan per block). Worker logs: `ERC20: START/END API CALL` lines.",
    category: DEPOSIT_SCANNER_CATEGORIES.usdtErc20,
    type: "int",
  },
  {
    key: "DEPOSIT_SCANNER_API_MAX_PER_SECOND_ERC20",
    label:
      "Etherscan deposit poll: max **parallel block** fetches per tick and max **HTTP starts** per rolling 1s (includes `eth_blockNumber` + `getLogs`). Blocks are **sorted by height** before `advanceScanner`. **`0` = internal default 3/sec** (Etherscan free-tier safe); set `4`+ only if your API plan allows higher burst.",
    category: DEPOSIT_SCANNER_CATEGORIES.usdtErc20,
    type: "int",
  },
  {
    key: "DEPOSIT_SCANNER_TRON_ONLY",
    label:
      "Only walk Ethereum blocks when at least one live ETH wallet exists (lighter when true)",
    category: DEPOSIT_SCANNER_CATEGORIES.usdtErc20,
    type: "bool",
  },
  {
    key: "EVM_DEPOSIT_SCAN_MAX_BLOCKS_PER_TICK",
    label:
      "Max Ethereum blocks per ERC20 tick (1–50; default 4). Each block = one Etherscan getLogs — lower = faster ticks, slower catch-up if behind tip.",
    category: DEPOSIT_SCANNER_CATEGORIES.usdtErc20,
    type: "int",
  },

  {
    key: "WORKER_POLL_INTERVAL_SEC_TRC20",
    label:
      "Timer between ticks (seconds, min 1) — PM2 `crypto-gateway-worker-trc20`; each tick can take longer (TronScan per address + callbacks). Worker logs: `TRC20: START/END API CALL` lines.",
    category: DEPOSIT_SCANNER_CATEGORIES.usdtTrc20,
    type: "int",
  },
  {
    key: "DEPOSIT_SCANNER_API_MAX_PER_SECOND_TRC20",
    label:
      "TronScan deposit poll: caps **parallel** worker tasks per tick (`min` vs explorer key pool sum) and max **HTTP starts** per rolling 1s via `acquireDepositScannerApiSlot` (no full serialization — up to N fetches can be in flight). Example `4` ≈ four concurrent address polls, with further starts delayed to the next rolling second. `0` = no rail-specific start cap (explorer pool + `OUTBOUND_RPC_MAX_PER_SECOND` for `TRON` still apply).",
    category: DEPOSIT_SCANNER_CATEGORIES.usdtTrc20,
    type: "int",
  },
  {
    key: "CHAIN_ENABLED",
    label:
      "Per-chain on/off for deposits, gateway rails, and scanners (edit in Admin → Supported chains)",
    category: "Supported chains",
    type: "json",
    hideFromAdminList: true,
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
    key: "ETHERSCAN_API_BASE",
    label: "Etherscan API v2 base URL (USDT·ERC20 deposit scan + ETH USDT balance — getLogs / tokenbalance; no RPC_ETH)",
    category: "ERC20 · Etherscan",
    type: "string",
  },

  {
    key: "SWEEP_MASTER_TRON",
    label: "Sweep master · TRON (USDT/TRC20)",
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
    key: "SWEEP_TRX_FUNDER_ADDRESS",
    label: "TRX funder address (sanity check)",
    category: "Sweep · TRON auto",
    type: "string",
  },
  {
    key: "SWEEP_TRX_TOPUP_SUN",
    label:
      "TRX top-up base (sun, legacy — auto-sweep uses dynamic fee estimate)",
    category: "Sweep · TRON auto",
    type: "bigint",
  },
  {
    key: "SWEEP_TRON_USDT_MIN_ATOMIC",
    label: "Min USDT for auto-sweep",
    category: "Sweep · TRON auto",
    type: "usdt6",
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
    key: "GATEWAY_SANDBOX",
    label: "Allow live API key for sandbox simulate-deposit",
    category: "Gateway",
    type: "bool",
  },
  {
    key: "GATEWAY_TRON_USDT_ONLY",
    label: "Gateway accepts USDT·TRC20 only (hide other rails from API)",
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
];

/** @type {Map<string, AppSettingDef>} */
export const APP_SETTING_DEF_BY_KEY = new Map(
  APP_SETTING_DEFINITIONS.map((d) => [d.key, d]),
);
