async function main() {
  const { loadAppSettingsFromDatabase } = await import(
    "./lib/app-settings-runtime.js",
  );
  await loadAppSettingsFromDatabase();

  const { createApp } = await import("./app.js");
  const { env } = await import("./config/env.js");
  const { logger } = await import("./lib/logger.js");

  const app = createApp();

  app.listen(env.port, () => {
    logger.info("http listening", { port: env.port });
  });

  logger.info(
    "deposit scanner runs in PM2 crypto-gateway-worker (`npm run start:worker -w cron` or ecosystem.config.cjs)",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
