/**
 * All-in-one: worker + maintenance + tron-sweep groups (single process).
 * Does **not** include deposit full-scan — run `entry-cron-deposit-full-scan.js` separately (or PM2 app).
 * Production PM2: worker, maintenance, deposit-full-scan, tron-sweep as separate apps.
 */
import { bootstrapCronRuntime } from "./bootstrap-runtime.js";

await bootstrapCronRuntime();
await import("./run.js");
