import { registerCronGroup2 } from "./jobs/group2.js";
import { startScheduledJobsHost } from "./lib/scheduled-jobs-host.js";

startScheduledJobsHost(registerCronGroup2, { label: "crypto-gateway-cron-2" });
