import * as Yup from "yup";

const USDT6 = 1_000_000n;

/** Optional [min, max] for known int keys (must match server `validateStoredValue`). */
const INT_SETTING_BOUNDS = {
  CHECKOUT_EXPIRY_CRON_MINUTES: [1, 59],
  CHECKOUT_CREATED_EXPIRY_HOURS: [1, 8760],
};

/**
 * @param {{ key: string, type?: string }[]} items
 */
export function buildSystemSettingsSchema(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return Yup.object({});
  }
  /** @type {Record<string, import("yup").StringSchema>} */
  const shape = {};
  for (const it of items) {
    if (it.type === "usdt6") {
      shape[it.key] = Yup.string().test(
        "usdt6_amount",
        "Enter a USDT amount (e.g. 1 for 1 USDT), up to 6 decimal places, or clear to use .env default",
        (val) => {
          if (val == null || String(val).trim() === "") return true;
          const t = String(val).trim();
          if (!/^\d+(\.\d{0,6})?$/.test(t)) return false;
          const [ip, fp = ""] = t.split(".");
          const whole = BigInt(ip === "" ? "0" : ip);
          const frac = BigInt((fp + "000000").slice(0, 6) || "0");
          const atomic = whole * USDT6 + frac;
          return atomic >= 1n;
        },
      );
    } else if (it.type === "int") {
      const bounds = INT_SETTING_BOUNDS[it.key];
      shape[it.key] = Yup.string().test(
        "int_setting",
        bounds
          ? `Enter a whole number ${bounds[0]}–${bounds[1]}, or clear for .env default`
          : "Enter a whole number (0–9 only), or clear for .env default",
        (val) => {
          if (val == null || String(val).trim() === "") return true;
          const t = String(val).trim();
          if (!/^\d+$/.test(t)) return false;
          const n = parseInt(t, 10);
          if (!Number.isFinite(n)) return false;
          if (bounds) return n >= bounds[0] && n <= bounds[1];
          return true;
        },
      );
    } else {
      shape[it.key] = Yup.string();
    }
  }
  return Yup.object(shape);
}
