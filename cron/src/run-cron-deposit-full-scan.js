import { startScheduledJobsHost } from "./lib/scheduled-jobs-host.js";
import { registerDepositFullScanCron } from "./jobs/deposit-full-scan-cron.js";

/**
 * PM2 `crypto-gateway-cron-deposit-full-scan` only — not bundled with worker or other cron groups.
 */
startScheduledJobsHost(
  (ctx) => {
    registerDepositFullScanCron(ctx);
  },
  { label: "crypto-gateway-cron-deposit-full-scan" },
);
