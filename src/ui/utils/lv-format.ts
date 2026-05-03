/**
 * Format a `LogEntry.timestamp` (epoch ms or null) for the row gutter.
 * Returns `'—'` for null timestamps. With `showDate`, prepends `MM-DD `.
 */
export const lvFmtTime = (timestamp: number | null, showDate = false): string => {
  if (timestamp === null) return '—';
  const d = new Date(timestamp);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  const ms = String(d.getUTCMilliseconds()).padStart(3, '0');
  const t = `${hh}:${mm}:${ss}.${ms}`;
  if (!showDate) return t;
  const dt = d.toISOString().slice(5, 10);
  return `${dt} ${t}`;
};
