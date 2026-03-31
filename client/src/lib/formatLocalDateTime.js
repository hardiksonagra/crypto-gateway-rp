/**
 * Format API / DB instants for display in the user's local timezone and locale.
 */

/**
 * @param {string | number | Date | null | undefined} value
 * @param {{ fallback?: string }} [opts]
 * @returns {string}
 */
export function formatLocalDateTime(value, opts = {}) {
  const fallback = opts.fallback ?? "—";
  if (value === null || value === undefined || value === "") return fallback;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return fallback;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * @param {string | number | Date | null | undefined} value
 * @param {{ fallback?: string }} [opts]
 * @returns {string}
 */
export function formatLocalDate(value, opts = {}) {
  const fallback = opts.fallback ?? "—";
  if (value === null || value === undefined || value === "") return fallback;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return fallback;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

/**
 * Last `count` calendar dates ending today in `timeZone` (YYYY-MM-DD), for chart bucketing.
 * Mirrors server `lastNDatesInZone` — keep logic aligned if you change one.
 *
 * @param {number} count
 * @param {string} timeZone IANA zone e.g. Asia/Kolkata
 * @returns {string[]}
 */
export function lastNDatesInZone(count, timeZone) {
  /** @param {number} y @param {number} m @param {number} d @param {number} deltaDays */
  function ymdAddDays(y, m, d, deltaDays) {
    const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
    return {
      y: dt.getUTCFullYear(),
      m: dt.getUTCMonth() + 1,
      d: dt.getUTCDate(),
    };
  }
  /** @param {Date} date */
  function getYmdInZone(date) {
    const f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = f.formatToParts(date);
    const p = Object.fromEntries(
      parts.filter((x) => x.type !== "literal" && x.type !== "timeZoneName").map((x) => [x.type, x.value]),
    );
    return { y: Number(p.year), m: Number(p.month), d: Number(p.day) };
  }
  const pad2 = (n) => String(n).padStart(2, "0");
  const start = getYmdInZone(new Date());
  const keys = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const cal = ymdAddDays(start.y, start.m, start.d, -i);
    keys.push(`${cal.y}-${pad2(cal.m)}-${pad2(cal.d)}`);
  }
  return keys;
}
