import { bootstrapCronRuntime } from "./bootstrap-runtime.js";

await bootstrapCronRuntime();
await import("./run-cron-1.js");
