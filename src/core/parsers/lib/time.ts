/**
 * Best-effort timestamp normalisation. Returns epoch milliseconds or
 * `null` when the input can't be parsed.
 *
 * - `number` → seconds (anything below 1e11) get multiplied by 1000;
 *   anything bigger is treated as milliseconds. Heuristic, but
 *   matches the de-facto convention (Unix seconds ≪ 1e11 until 5138).
 * - `string` → `Date.parse(...)` is enough for ISO-8601 and the
 *   common RFC-822 / RFC-2822 inputs (`Mon, 05 May 2026 10:00:00 GMT`).
 * - anything else (`null`, objects, arrays) → `null`.
 */
export const parseTimestamp = (value: unknown): number | null => {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e11 ? Math.floor(value * 1000) : Math.floor(value);
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const APACHE_TIME_RE =
  /^(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-]\d{4})$/;

const MONTHS: Readonly<Record<string, number>> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

/**
 * Parse Apache/Nginx access-log `time_local` format:
 *   `05/May/2026:06:00:00 +0000`
 * Returns epoch ms or `null`.
 */
export const parseApacheTime = (raw: string): number | null => {
  const m = APACHE_TIME_RE.exec(raw);
  if (m === null) return null;
  const [, dd, mon, yyyy, hh, mm, ss, tz] = m;
  const month = MONTHS[mon!];
  if (month === undefined) return null;
  const tzMin =
    (tz!.startsWith('-') ? -1 : 1) *
    (Number(tz!.slice(1, 3)) * 60 + Number(tz!.slice(3, 5)));
  const utc = Date.UTC(
    Number(yyyy),
    month,
    Number(dd),
    Number(hh),
    Number(mm),
    Number(ss),
  );
  return Number.isFinite(utc) ? utc - tzMin * 60_000 : null;
};

const SYSLOG_TIME_RE =
  /^(\w{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})$/;

/**
 * Parse RFC 3164 / BSD-syslog `Mon DD HH:MM:SS` (no year, no tz).
 * `nowYear` is used to pick the year — if the parsed date would be in
 * the future, we subtract one year (typical log-rotation case).
 */
export const parseSyslogTime = (raw: string, nowMs: number = Date.now()): number | null => {
  const m = SYSLOG_TIME_RE.exec(raw.trim());
  if (m === null) return null;
  const [, mon, dd, hh, mm, ss] = m;
  const month = MONTHS[mon!];
  if (month === undefined) return null;
  const now = new Date(nowMs);
  const year = now.getUTCFullYear();
  const t = Date.UTC(year, month, Number(dd), Number(hh), Number(mm), Number(ss));
  if (!Number.isFinite(t)) return null;
  // Future date → assume previous year (log line written in December,
  // viewed in January).
  return t > nowMs + 86_400_000 ? t - 365 * 86_400_000 : t;
};
