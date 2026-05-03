import { describe, expect, it } from 'vitest';
import type { EntryId, LogEntry, SourceId } from '../types/index.ts';
import { buildCsv, buildJsonl, csvEscape } from './export.ts';

const mkEntry = (overrides: Partial<LogEntry> = {}): LogEntry => ({
  id: 'e-1' as EntryId,
  sourceId: 's-A' as SourceId,
  seq: 1,
  timestamp: Date.UTC(2026, 0, 2, 3, 4, 5),
  level: 'info',
  message: 'hello',
  raw: 'hello',
  fields: {},
  ...overrides,
});

describe('csvEscape', () => {
  it('returns plain values unchanged', () => {
    expect(csvEscape('plain')).toBe('plain');
    expect(csvEscape('')).toBe('');
  });

  it('quotes values containing a comma', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
  });

  it('doubles internal quotes and wraps in quotes', () => {
    expect(csvEscape('he said "hi"')).toBe('"he said ""hi"""');
  });

  it('quotes values containing CR or LF', () => {
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
    expect(csvEscape('a\rb')).toBe('"a\rb"');
  });
});

describe('buildJsonl', () => {
  it('returns empty string for empty input', () => {
    expect(buildJsonl([])).toBe('');
  });

  it('emits one JSON object per line + trailing LF', () => {
    const out = buildJsonl([
      mkEntry({ id: 'e-1' as EntryId, message: 'one' }),
      mkEntry({ id: 'e-2' as EntryId, message: 'two', seq: 2 }),
    ]);
    const lines = out.split('\n');
    expect(lines).toHaveLength(3); // 2 entries + trailing empty
    expect(lines[2]).toBe('');
    expect(JSON.parse(lines[0]!).message).toBe('one');
    expect(JSON.parse(lines[1]!).message).toBe('two');
  });
});

describe('buildCsv', () => {
  it('emits the canonical header even on empty input', () => {
    expect(buildCsv([])).toBe('timestamp,level,source_id,seq,message,fields_json\n');
  });

  it('formats timestamps as ISO-8601 and serializes fields as JSON', () => {
    const out = buildCsv([
      mkEntry({
        timestamp: Date.UTC(2026, 0, 2, 3, 4, 5),
        fields: { svc: 'api' },
      }),
    ]);
    const [, row] = out.trimEnd().split('\n');
    expect(row).toBe('2026-01-02T03:04:05.000Z,info,s-A,1,hello,"{""svc"":""api""}"');
  });

  it('renders null timestamps as empty cell', () => {
    const out = buildCsv([mkEntry({ timestamp: null })]);
    const row = out.trimEnd().split('\n')[1]!;
    expect(row.startsWith(',info,')).toBe(true);
  });

  it('escapes commas and newlines inside message', () => {
    const out = buildCsv([
      mkEntry({ message: 'comma, in msg', fields: {} }),
      mkEntry({ message: 'line1\nline2', fields: {} }),
    ]);
    const lines = out.trimEnd().split('\n');
    expect(lines[1]).toContain('"comma, in msg"');
    // The newline inside a quoted CSV cell is preserved — split('\n') sees it
    // as an extra line, but that's expected (RFC 4180 multiline cells).
    expect(out).toContain('"line1\nline2"');
  });
});
