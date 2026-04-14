import { re } from "crypto-payment-gateway/src/config/runtime-env.js";
import { etherscanApiHostnameForLog } from "crypto-payment-gateway/src/lib/etherscan-client.js";
import { logger } from "crypto-payment-gateway/src/lib/logger.js";
import {
  startBlockchainWorker,
  stopBlockchainWorker,
} from "./services/tracker/worker.js";

startBlockchainWorker();
logger.info("blockchain deposit / transaction tracker started (combined worker)", {
  note: "Both ERC20 + TRC20 rails in one process; each rail has its own work queue so a long TRC20 tick (sweep/callbacks) does not delay ERC20 polling. Production PM2: prefer crypto-gateway-worker-erc20 + crypto-gateway-worker-trc20. Poll: WORKER_POLL_INTERVAL_MS_ERC20 / WORKER_POLL_INTERVAL_MS_TRC20. Restart to apply ms. Full deposit scan: crypto-gateway-cron-deposit-full-scan",
  tron_deposit_scan: "tronscan",
  deposit_scanner_tron_only: re.depositScannerTronOnly,
  tronscan_key_configured: Boolean(re.tronscanApiKey?.trim()),
  etherscan_key_configured: Boolean(re.etherscanApiKey?.trim()),
  etherscan_api_host: etherscanApiHostnameForLog(),
  tronscan_host: (() => {
    try {
      return new URL(re.tronscanApiBase.replace(/\/$/, "")).hostname;
    } catch {
      return "invalid";
    }
  })(),
  ...(re.depositScannerTronOnly
    ? {
        note_evm:
          "DEPOSIT_SCANNER_TRON_ONLY=true: Ethereum USDT·ERC20 is only scanned when at least one live ETH wallet exists.",
      }
    : {}),
});

function shutdown(signal) {
  stopBlockchainWorker();
  logger.info("crypto-gateway-worker (combined) shutdown", { signal });
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
