import type { LogEntry } from '../types/index.ts';

/**
 * RFC 4180 CSV escaping. Wraps the value in double quotes and doubles any
 * internal `"` if the field contains a comma, quote, CR or LF; otherwise the
 * raw value is returned. Numeric/boolean callers must convert to string first.
 */
export const csvEscape = (v: string): string =>
  /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;

const CSV_HEADER: ReadonlyArray<string> = [
  'timestamp',
  'level',
  'source_id',
  'seq',
  'message',
  'fields_json',
];

/**
 * Serialize entries to the JSONL format the parser ingests — one JSON object
 * per line, terminated by `\n`. Empty input yields an empty string (no
 * trailing newline) so downstream Blobs don't emit a stray byte.
 */
export const buildJsonl = (
  entries: ReadonlyArray<LogEntry>,
): string => {
  if (entries.length === 0) return '';
  const lines: string[] = [];
  for (const e of entries) lines.push(JSON.stringify(e));
  return lines.join('\n') + '\n';
};

/**
 * Serialize entries to CSV with a stable column order:
 * `timestamp,level,source_id,seq,message,fields_json`.
 *
 * - `timestamp` is ISO-8601 (`null` → empty cell).
 * - `fields` is JSON-stringified into a single cell.
 * - All cells go through `csvEscape`; empty input returns just the header
 *   row + LF.
 */
export const buildCsv = (entries: ReadonlyArray<LogEntry>): string => {
  const lines = [CSV_HEADER.join(',')];
  for (const e of entries) {
    const row = [
      csvEscape(e.timestamp === null ? '' : new Date(e.timestamp).toISOString()),
      csvEscape(e.level),
      csvEscape(e.sourceId),
      csvEscape(String(e.seq)),
      csvEscape(e.message),
      csvEscape(JSON.stringify(e.fields)),
    ];
    lines.push(row.join(','));
  }
  return lines.join('\n') + '\n';
};

export type ExportFormat = 'jsonl' | 'csv';

export const exportMimeType = (format: ExportFormat): string =>
  format === 'jsonl' ? 'application/x-ndjson' : 'text/csv';

export const exportExtension = (format: ExportFormat): string =>
  format === 'jsonl' ? 'jsonl' : 'csv';
