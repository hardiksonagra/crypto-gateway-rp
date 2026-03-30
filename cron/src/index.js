/**
 * All-in-one: worker + every cron group (local dev / single process).
 * Production PM2: use `entry-worker.js`, `entry-cron-1.js`, `entry-cron-2.js` instead.
 */
import { bootstrapCronRuntime } from "./bootstrap-runtime.js";

await bootstrapCronRuntime();
await import("./run.js");
