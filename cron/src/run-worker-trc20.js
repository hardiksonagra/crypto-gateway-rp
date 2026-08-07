import { re } from "crypto-payment-gateway/src/config/runtime-env.js";
import { logger } from "crypto-payment-gateway/src/lib/logger.js";
import {
  startTrc20DepositWorker,
  stopTrc20DepositWorker,
} from "./services/tracker/worker.js";

startTrc20DepositWorker();
logger.info("deposit worker (TRC20) started", {
  app: "crypto-gateway-worker-trc20",
  poll_ms: re.workerPollMsTrc20,
  setting: "WORKER_POLL_INTERVAL_SEC_TRC20",
  note: "Sweep stub + payment webhook retries run on this process only (avoid duplicate work vs ERC20 worker).",
});

function shutdown(signal) {
  stopTrc20DepositWorker();
  logger.info("crypto-gateway-worker-trc20 shutdown", { signal });
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
