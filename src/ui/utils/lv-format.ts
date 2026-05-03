export function lvFmtTime(iso: string, showDate = false): string {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  const ms = String(d.getUTCMilliseconds()).padStart(3, '0');
  const t = `${hh}:${mm}:${ss}.${ms}`;
  if (!showDate) return t;
  const dt = d.toISOString().slice(5, 10);
  return `${dt} ${t}`;
}
