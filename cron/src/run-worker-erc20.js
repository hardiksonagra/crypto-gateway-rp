import { re } from "crypto-payment-gateway/src/config/runtime-env.js";
import { logger } from "crypto-payment-gateway/src/lib/logger.js";
import {
  startErc20DepositWorker,
  stopErc20DepositWorker,
} from "./services/tracker/worker.js";

startErc20DepositWorker();
logger.info("deposit worker (ERC20) started", {
  app: "crypto-gateway-worker-erc20",
  poll_ms: re.workerPollMsErc20,
  setting: "WORKER_POLL_INTERVAL_SEC_ERC20",
});

function shutdown(signal) {
  stopErc20DepositWorker();
  logger.info("crypto-gateway-worker-erc20 shutdown", { signal });
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
