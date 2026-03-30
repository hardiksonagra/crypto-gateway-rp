import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Dotenv + DB app settings. Call before any job that reads gateway env/settings.
 * Loads repo-root `.env` (if present), then `cron/.env` — on a dedicated cron host you can ship only `cron/.env`
 * with the same `DATABASE_URL` / RPC / secrets as production API.
 * @returns {Promise<void>}
 */
export async function bootstrapCronRuntime() {
  dotenv.config({ path: path.resolve(__dirname, "../../.env") });
  dotenv.config({ path: path.resolve(__dirname, "../.env") });
  const { loadAppSettingsFromDatabase } = await import(
    "crypto-payment-gateway/src/lib/app-settings-runtime.js",
  );
  await loadAppSettingsFromDatabase();
}
