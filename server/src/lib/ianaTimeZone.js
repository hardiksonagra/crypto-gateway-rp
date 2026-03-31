/**
 * @param {unknown} input
 * @returns {string | null} IANA zone or null if invalid / unsupported
 */
export function sanitizeIanaTimeZone(input) {
  if (typeof input !== "string") return null;
  const s = input.trim();
  if (!s || s.length > 120) return null;
  if (!/^[A-Za-z0-9_+\/-]+$/.test(s)) return null;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: s }).format(new Date());
    return s;
  } catch {
    return null;
  }
}

/**
 * Last `count` calendar dates ending today in `timeZone` (YYYY-MM-DD).
 * Keep aligned with client `lastNDatesInZone` in formatLocalDateTime.js.
 *
 * @param {number} count
 * @param {string} timeZone
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
