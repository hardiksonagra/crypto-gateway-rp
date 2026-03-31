import cron from "node-cron";
import { logger } from "crypto-payment-gateway/src/lib/logger.js";
import { registerJobs } from "./jobs/index.js";
import {
  startBlockchainWorker,
  stopBlockchainWorker,
} from "./services/tracker/worker.js";

const tasks = [];

function schedule(expression, handler, options) {
  const task = cron.schedule(expression, handler, options);
  tasks.push(task);
  return task;
}

registerJobs({ schedule });

startBlockchainWorker();
logger.info("deposit / transaction tracker started (cron service)");

function shutdown(signal) {
  stopBlockchainWorker();
  for (const t of tasks) {
    try {
      t.stop();
    } catch {
      /* ignore */
    }
  }
  logger.info("crypto-gateway-cron-combined shutdown", {
    signal,
    cronTasksStopped: tasks.length,
  });
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

logger.info("crypto-gateway-cron-combined: ready", {
  nodeCronTasks: tasks.length,
  note: "full deposit scan is a separate process: crypto-gateway-cron-deposit-full-scan (or npm run start:cron:deposit-full-scan -w cron)",
});
