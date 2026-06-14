/**
 * Format a `LogEntry.timestamp` (epoch ms or null) for the row gutter.
 * Returns `'—'` for null timestamps.
 *
 * Default output is the full UTC date + time + millis
 * (`YYYY-MM-DD HH:MM:SS.mmm`) — the column is meant to show the same
 * instant the source file recorded, so users can correlate against
 * raw logs without losing the date. `showDate=false` is the opt-out:
 * drops the date prefix when the user explicitly wants the compact
 * `HH:MM:SS.mmm` form (e.g. narrow screens).
 */
export const lvFmtTime = (
  timestamp: number | null,
  showDate = true,
): string => {
  if (timestamp === null) return '—';
  const d = new Date(timestamp);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  const ms = String(d.getUTCMilliseconds()).padStart(3, '0');
  const t = `${hh}:${mm}:${ss}.${ms}`;
  if (!showDate) return t;
  const dt = d.toISOString().slice(0, 10);
  return `${dt} ${t}`;
};
