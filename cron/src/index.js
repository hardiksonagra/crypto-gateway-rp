import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Must run before any `crypto-payment-gateway` import (loads server `env`). */
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const { loadAppSettingsFromDatabase } = await import(
  "crypto-payment-gateway/src/lib/app-settings-runtime.js",
);
await loadAppSettingsFromDatabase();
await import("./run.js");
