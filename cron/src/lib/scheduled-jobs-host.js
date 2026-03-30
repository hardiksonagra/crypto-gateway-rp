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

  if (tasks.length === 0) {
    logger.warn("scheduled_jobs_host_zero_tasks", {
      label,
      note: "No node-cron tasks registered (e.g. SWEEP_TRON_AUTO_CRON_ENABLED=false). Installing a keepalive timer so PM2 does not spin-restart an empty event loop.",
    });
    // Without any cron timers, Node can exit immediately; PM2 autorestart then loops. One long-interval handle keeps the process up until you enable a job or stop this PM2 app.
    setInterval(() => {}, 86_400_000);
  }

  logger.info("scheduled jobs host ready", {
    label,
    nodeCronTasks: tasks.length,
  });
}
