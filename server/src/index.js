async function main() {
  // Loads `.env` (see `config/env.js`) before Prisma `$connect` — required for `DATABASE_URL`.
  await import("./config/env.js");

  const { syncActiveRowWithGeneratedPrismaClient } = await import(
    "./lib/prisma.js",
  );
  await syncActiveRowWithGeneratedPrismaClient();

  const { loadAppSettingsFromDatabase } = await import(
    "./lib/app-settings-runtime.js",
  );
  await loadAppSettingsFromDatabase();

  const { createApp } = await import("./app.js");
  const { env } = await import("./config/env.js"); // same module as first import
  const { logger } = await import("./lib/logger.js");

  const app = createApp();

  app.listen(env.port, () => {
    logger.info("http listening", { port: env.port });
  });

  logger.info(
    "deposit scanners: PM2 crypto-gateway-worker-erc20 + crypto-gateway-worker-trc20 (or combined `npm run start:worker -w cron`); see ecosystem.config.cjs",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
