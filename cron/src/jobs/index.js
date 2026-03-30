import { registerCronGroup1 } from "./group1.js";
import { registerCronGroup2 } from "./group2.js";

/**
 * All scheduled jobs (combined process). Split groups: `group1.js` / `group2.js` + PM2 apps.
 *
 * @param {{ schedule: (expression: string, handler: () => void, options?: object) => import("node-cron").ScheduledTask }} ctx
 */
export function registerJobs(ctx) {
  registerCronGroup1(ctx);
  registerCronGroup2(ctx);
}
