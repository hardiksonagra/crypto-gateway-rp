import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { startBlockchainWorker } from "./services/tracker/worker.js";

/**
 * Process entry: HTTP API + blockchain worker in one deployable unit.
 * For very high throughput, split `worker-entry` into isolated autoscaled workers.
 */
const app = createApp();

app.listen(env.port, () => {
  logger.info("http listening", { port: env.port });
});

startBlockchainWorker();
