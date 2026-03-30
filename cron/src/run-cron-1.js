import { registerCronGroup1 } from "./jobs/group1.js";
import { startScheduledJobsHost } from "./lib/scheduled-jobs-host.js";

startScheduledJobsHost(registerCronGroup1, {
  label: "crypto-gateway-cron-maintenance",
});
