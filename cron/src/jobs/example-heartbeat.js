/**
 * Sample job — replace or remove. Expression uses server local time unless `TZ` is set.
 * @param {{ schedule: (expression: string, handler: () => void, options?: object) => import('node-cron').ScheduledTask }} ctx
 */
export function registerExampleHeartbeat(ctx) {
  const enabled = (process.env.CRON_EXAMPLE_HEARTBEAT ?? "false").toLowerCase() === "true";
  if (!enabled) return;

  const opts = process.env.CRON_TZ ? { timezone: process.env.CRON_TZ } : undefined;
  ctx.schedule("*/5 * * * *", () => {
    console.info(
      "crypto-gateway-cron: example heartbeat (set CRON_EXAMPLE_HEARTBEAT=false to disable)",
    );
  }, opts);
}
