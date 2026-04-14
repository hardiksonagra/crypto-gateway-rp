/**
 * Process env merged with `app_settings` DB overrides (when loaded via `loadAppSettingsFromDatabase`).
 * Use `re` for tunable ops config; keep `env` for bootstrap secrets (mnemonic, JWT, DB URL, …).
 */
import { env, normalizeBrowserOrigin } from "./env.js";
import {
  getResolvedBigInt,
  getResolvedBool,
  getResolvedBoolTronGateway,
  getResolvedInt,
  getResolvedString,
} from "../lib/app-settings-runtime.js";
import { parseChainEnabledRecord } from "../lib/chain-enable.js";

function splitOrigins(raw) {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(normalizeBrowserOrigin);
}

export const re = {
  get logLevel() {
    return getResolvedString("LOG_LEVEL", () => env.logLevel);
  },

  get clientOrigins() {
    const raw = getResolvedString("CLIENT_ORIGINS", () =>
      env.clientOrigins.join(","),
    );
    return splitOrigins(raw);
  },

  get appPublicUrl() {
    return getResolvedString("APP_PUBLIC_URL", () => env.appPublicUrl);
  },

  get paymentPagePublicUrl() {
    return getResolvedString("PAYMENT_PAGE_PUBLIC_URL", () =>
      env.paymentPagePublicUrl,
    );
  },

  get passwordResetTtlMinutes() {
    return getResolvedInt("PASSWORD_RESET_TTL_MINUTES", () =>
      env.passwordResetTtlMinutes,
    );
  },

  get smtpHost() {
    return getResolvedString("SMTP_HOST", () => env.smtpHost ?? "");
  },

  get smtpPort() {
    return getResolvedInt("SMTP_PORT", () => env.smtpPort);
  },

  get smtpSecure() {
    return getResolvedBool("SMTP_SECURE", () => env.smtpSecure);
  },

  get smtpUser() {
    return getResolvedString("SMTP_USER", () => env.smtpUser ?? "");
  },

  get smtpPass() {
    return getResolvedString("SMTP_PASS", () => env.smtpPass ?? "");
  },

  get smtpFrom() {
    return getResolvedString("SMTP_FROM", () => env.smtpFrom);
  },

  get confirmationsEvm() {
    return getResolvedInt("CONFIRMATIONS_EVM", () => env.confirmationsEvm);
  },

  get confirmationsTron() {
    return getResolvedInt("CONFIRMATIONS_TRON", () => env.confirmationsTron);
  },

  get confirmationsBtc() {
    return getResolvedInt("CONFIRMATIONS_BTC", () => env.confirmationsBtc);
  },

  get confirmationsTon() {
    return getResolvedInt("CONFIRMATIONS_TON", () => env.confirmationsTon);
  },

  get confirmationsSolana() {
    return getResolvedInt("CONFIRMATIONS_SOLANA", () => env.confirmationsSolana);
  },

  get workerPollMs() {
    return getResolvedInt("WORKER_POLL_INTERVAL_MS", () => env.workerPollMs);
  },

  get walletScanTtlMinutes() {
    return getResolvedInt("WALLET_SCAN_TTL_MINUTES", () =>
      env.walletScanTtlMinutes,
    );
  },

  get walletAssignmentHoldMinutes() {
    return getResolvedInt("WALLET_ASSIGNMENT_HOLD_MINUTES", () =>
      env.walletAssignmentHoldMinutes,
    );
  },

  get walletPoolHoldReleaseCronMinutes() {
    return getResolvedInt("WALLET_POOL_HOLD_RELEASE_CRON_MINUTES", () =>
      env.walletPoolHoldReleaseCronMinutes,
    );
  },

  get lateDepositRecheckHours() {
    return getResolvedInt("LATE_DEPOSIT_RECHECK_HOURS", () =>
      env.lateDepositRecheckHours,
    );
  },

  get depositFullScanIntervalHours() {
    return getResolvedInt("DEPOSIT_FULL_SCAN_INTERVAL_HOURS", () =>
      env.depositFullScanIntervalHours,
    );
  },

  get workerLogRailCounts() {
    return getResolvedString("WORKER_LOG_RAIL_COUNTS", () =>
      env.workerLogRailCounts,
    );
  },

  get depositScannerTronOnly() {
    return getResolvedBool("DEPOSIT_SCANNER_TRON_ONLY", () =>
      env.depositScannerTronOnly,
    );
  },

  /**
   * Parsed `CHAIN_ENABLED` map (false = disabled). Empty object means all chains on.
   * @returns {Record<string, boolean>}
   */
  get chainEnabledRecord() {
    const raw = getResolvedString("CHAIN_ENABLED", () => env.chainEnabledJson ?? "{}");
    return parseChainEnabledRecord(raw);
  },

  get rpcEth() {
    return getResolvedString("RPC_ETH", () => env.rpcEth);
  },

  get rpcBnb() {
    return getResolvedString("RPC_BNB", () => env.rpcBnb);
  },

  get rpcPolygon() {
    return getResolvedString("RPC_POLYGON", () => env.rpcPolygon);
  },

  get rpcArbitrum() {
    return getResolvedString("RPC_ARBITRUM", () => env.rpcArbitrum);
  },

  get rpcOptimism() {
    return getResolvedString("RPC_OPTIMISM", () => env.rpcOptimism);
  },

  get etherscanApiBase() {
    return getResolvedString("ETHERSCAN_API_BASE", () => env.etherscanApiBase).replace(
      /\/$/,
      "",
    );
  },

  get etherscanApiKey() {
    return getResolvedString("ETHERSCAN_API_KEY", () => env.etherscanApiKey ?? "");
  },

  get tronFullNode() {
    return getResolvedString("TRON_FULL_NODE", () => env.tronFullNode);
  },

  get tronscanApiBase() {
    return getResolvedString("TRONSCAN_API_BASE", () => env.tronscanApiBase).replace(
      /\/$/,
      "",
    );
  },

  get tronscanApiKey() {
    return getResolvedString("TRONSCAN_API_KEY", () => env.tronscanApiKey ?? "");
  },

  get tronSolidityNode() {
    return getResolvedString("TRON_SOLIDITY_NODE", () => env.tronSolidityNode);
  },

  get tronEventServer() {
    return getResolvedString("TRON_EVENT_SERVER", () => env.tronEventServer);
  },

  get tronApiKey() {
    return getResolvedString("TRON_API_KEY", () => env.tronApiKey ?? "");
  },

  get tonApiBase() {
    return getResolvedString("TON_API_BASE", () => env.tonApiBase);
  },

  get tonApiKey() {
    return getResolvedString("TON_API_KEY", () => env.tonApiKey ?? "");
  },

  get btcExplorerApiBase() {
    return getResolvedString("BTC_EXPLORER_API_BASE", () =>
      env.btcExplorerApiBase,
    );
  },

  get sweepMasterEvm() {
    return getResolvedString("SWEEP_MASTER_EVM", () => env.sweepMasterEvm ?? "");
  },

  get sweepMasterTron() {
    return getResolvedString("SWEEP_MASTER_TRON", () => env.sweepMasterTron ?? "");
  },

  get sweepMasterTrx() {
    return getResolvedString("SWEEP_MASTER_TRX", () => env.sweepMasterTrx ?? "");
  },

  get sweepMasterUsdtEth() {
    return getResolvedString("SWEEP_MASTER_USDT_ETH", () =>
      env.sweepMasterUsdtEth ?? "",
    );
  },

  get sweepMasterUsdtBnb() {
    return getResolvedString("SWEEP_MASTER_USDT_BNB", () =>
      env.sweepMasterUsdtBnb ?? "",
    );
  },

  get sweepMasterBtc() {
    return getResolvedString("SWEEP_MASTER_BTC", () => env.sweepMasterBtc ?? "");
  },

  get sweepMasterSolana() {
    return getResolvedString("SWEEP_MASTER_SOLANA", () =>
      env.sweepMasterSolana ?? "",
    );
  },

  get sweepTrxFunderAddress() {
    return getResolvedString("SWEEP_TRX_FUNDER_ADDRESS", () =>
      env.sweepTrxFunderAddress ?? "",
    );
  },

  get sweepTrxTopupSun() {
    return getResolvedBigInt("SWEEP_TRX_TOPUP_SUN", () => env.sweepTrxTopupSun);
  },

  get sweepTronUsdtMinAtomic() {
    return getResolvedBigInt("SWEEP_TRON_USDT_MIN_ATOMIC", () =>
      env.sweepTronUsdtMinAtomic,
    );
  },

  get sweepTronAutoCronEnabled() {
    return getResolvedBool("SWEEP_TRON_AUTO_CRON_ENABLED", () =>
      env.sweepTronAutoCronEnabled,
    );
  },

  get sweepTronAutoCronMinutes() {
    return getResolvedInt("SWEEP_TRON_AUTO_CRON_MINUTES", () =>
      env.sweepTronAutoCronMinutes,
    );
  },

  get solanaRpcUrl() {
    return getResolvedString("SOLANA_RPC_URL", () => env.solanaRpcUrl);
  },

  get solanaUsdtMint() {
    return getResolvedString("SOLANA_USDT_MINT", () => env.solanaUsdtMint);
  },

  get gatewaySandbox() {
    return getResolvedBool("GATEWAY_SANDBOX", () => env.gatewaySandbox);
  },

  get gatewayTronUsdtOnly() {
    return getResolvedBoolTronGateway("GATEWAY_TRON_USDT_ONLY", () =>
      env.gatewayTronUsdtOnly,
    );
  },

  get outboundRpcMaxPerSecond() {
    return getResolvedInt("OUTBOUND_RPC_MAX_PER_SECOND", () =>
      env.outboundRpcMaxPerSecond,
    );
  },
};
