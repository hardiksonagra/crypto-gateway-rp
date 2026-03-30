import { re } from "crypto-payment-gateway/src/config/runtime-env.js";
import { logger } from "crypto-payment-gateway/src/lib/logger.js";
import {
  startBlockchainWorker,
  stopBlockchainWorker,
} from "./services/tracker/worker.js";

startBlockchainWorker();
logger.info("blockchain deposit / transaction tracker started (worker process)", {
  note: "poll interval: WORKER_POLL_INTERVAL_MS",
  tron_deposit_scan: "tronscan",
  tronscan_host: (() => {
    try {
      return new URL(re.tronscanApiBase.replace(/\/$/, "")).hostname;
    } catch {
      return "invalid";
    }
  })(),
});

function shutdown(signal) {
  stopBlockchainWorker();
  logger.info("crypto-gateway-worker shutdown", { signal });
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
