/**
 * Writes current `.env`-backed config into `app_settings` for whichever DB `DATABASE_URL` points to.
 *
 *   npm run sync-settings-from-env -w server
 *
 * (Uses `dotenv-cli` from the server `package.json` script so root `../.env` is loaded.)
 */
import { upsertAppSettingsFromCurrentEnv } from "../src/lib/app-settings-runtime.js";

const r = await upsertAppSettingsFromCurrentEnv();
console.log(
  `app_settings sync: ${r.upserted} upserted, ${r.skipped} skipped (empty / default JSON / invalid).`,
);
