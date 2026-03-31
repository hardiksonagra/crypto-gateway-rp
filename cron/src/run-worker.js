import { re } from "crypto-payment-gateway/src/config/runtime-env.js";
import { logger } from "crypto-payment-gateway/src/lib/logger.js";
import {
  startBlockchainWorker,
  stopBlockchainWorker,
} from "./services/tracker/worker.js";

startBlockchainWorker();
logger.info("blockchain deposit / transaction tracker started (worker process)", {
  note: "poll interval: WORKER_POLL_INTERVAL_MS; full deposit scan: separate PM2 app crypto-gateway-cron-deposit-full-scan",
  tron_deposit_scan: "tronscan",
  deposit_scanner_tron_only: re.depositScannerTronOnly,
  tronscan_key_configured: Boolean(re.tronscanApiKey?.trim()),
  tronscan_host: (() => {
    try {
      return new URL(re.tronscanApiBase.replace(/\/$/, "")).hostname;
    } catch {
      return "invalid";
    }
  })(),
  ...(re.depositScannerTronOnly
    ? {
        note_evm_ton:
          "DEPOSIT_SCANNER_TRON_ONLY=true: ETH/BNB + TON deposit polling skipped — USDT·ERC20 rows will not appear in evm_addresses_this_tick logs. Set env false to scan EVM.",
      }
    : {}),
});

function shutdown(signal) {
  stopBlockchainWorker();
  logger.info("crypto-gateway-worker shutdown", { signal });
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
