import { logger } from "./lib/logger.js";
import { startBlockchainWorker, stopBlockchainWorker } from "./services/tracker/worker.js";

/**
 * Standalone worker process (no HTTP server) — use when horizontally scaling listeners.
 */
startBlockchainWorker();

function shutdown(): void {
  stopBlockchainWorker();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

logger.info("standalone blockchain worker started");
