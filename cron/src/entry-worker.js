import { bootstrapCronRuntime } from "./bootstrap-runtime.js";

await bootstrapCronRuntime();
await import("./run-worker.js");
