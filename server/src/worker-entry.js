import { logger } from "./lib/logger.js";
import {
  startBlockchainWorker,
  stopBlockchainWorker,
} from "./services/tracker/worker.js";

startBlockchainWorker();

function shutdown() {
  stopBlockchainWorker();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

logger.info("standalone blockchain worker started");
