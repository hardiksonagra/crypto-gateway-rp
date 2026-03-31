import { refreshAppSettingsCache } from "crypto-payment-gateway/src/lib/app-settings-runtime.js";
import { prisma } from "crypto-payment-gateway/src/lib/prisma.js";
import { re } from "crypto-payment-gateway/src/config/runtime-env.js";
import { logger } from "crypto-payment-gateway/src/lib/logger.js";
import { runFullDepositScanPass } from "../services/deposit-full-scan-pass.js";

/** Internal watermark (not in admin settings registry). */
const LAST_AT_KEY = "DEPOSIT_FULL_SCAN_LAST_AT";

/**
 * Runs at most once per `DEPOSIT_FULL_SCAN_INTERVAL_HOURS` (admin / env / app_settings).
 * Uses a 1-minute cron tick and compares wall time to the stored last-run ISO timestamp.
 *
 * @param {{ schedule: (expression: string, handler: () => void, options?: object) => import("node-cron").ScheduledTask }} ctx
 */
export function registerDepositFullScanCron(ctx) {
  const opts = process.env.CRON_TZ ? { timezone: process.env.CRON_TZ } : undefined;
  ctx.schedule(
    "* * * * *",
    () => {
      void runMaybeFullDepositScan();
    },
    opts,
  );
  logger.info("cron_registered_deposit_full_scan", {
    event: "cron_registered_deposit_full_scan",
    note: "Interval from DEPOSIT_FULL_SCAN_INTERVAL_HOURS; eligibility checked every minute.",
  });
}

async function runMaybeFullDepositScan() {
  try {
    await refreshAppSettingsCache();
    const hours = Math.max(0, re.depositFullScanIntervalHours);
    if (hours <= 0) return;

    const intervalMs = hours * 3600 * 1000;
    const row = await prisma.appSetting.findUnique({
      where: { key: LAST_AT_KEY },
    });
    const lastMs = row?.value ? Date.parse(row.value) : NaN;
    const now = Date.now();
    if (Number.isFinite(lastMs) && now - lastMs < intervalMs) return;

    await runFullDepositScanPass();

    const iso = new Date().toISOString();
    await prisma.appSetting.upsert({
      where: { key: LAST_AT_KEY },
      create: { key: LAST_AT_KEY, value: iso },
      update: { value: iso },
    });
  } catch (e) {
    logger.error("deposit_full_scan_cron_failed", { err: String(e) });
  }
}
