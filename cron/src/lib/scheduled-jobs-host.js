import cron from "node-cron";
import { logger } from "crypto-payment-gateway/src/lib/logger.js";

/**
 * @param {(ctx: { schedule: typeof schedule }) => void} registerFn
 * @param {{ label: string }} meta
 */
export function startScheduledJobsHost(registerFn, meta) {
  const { label } = meta;
  const tasks = [];

  function schedule(expression, handler, options) {
    const task = cron.schedule(expression, handler, options);
    tasks.push(task);
    return task;
  }

  registerFn({ schedule });

  function shutdown(signal) {
    for (const t of tasks) {
      try {
        t.stop();
      } catch {
        /* ignore */
      }
    }
    logger.info("scheduled jobs host shutdown", {
      label,
      signal,
      cronTasksStopped: tasks.length,
    });
    process.exit(0);
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  logger.info("scheduled jobs host ready", {
    label,
    nodeCronTasks: tasks.length,
  });
}
