import * as Yup from "yup";

const USDT6 = 1_000_000n;

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
    } else {
      shape[it.key] = Yup.string();
    }
  }
  return Yup.object(shape);
}
