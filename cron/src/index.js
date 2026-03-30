/**
 * All-in-one: worker + every cron group (local dev / single process).
 * Production PM2: `entry-worker.js`, `entry-cron-1.js` (maintenance), `entry-cron-2.js` (tron sweep).
 */
import { bootstrapCronRuntime } from "./bootstrap-runtime.js";

await bootstrapCronRuntime();
await import("./run.js");
