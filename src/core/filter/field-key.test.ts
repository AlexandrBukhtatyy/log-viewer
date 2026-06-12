import { describe, expect, it } from 'vitest';
import type {
  EntryId,
  LogEntry,
  LogicalField,
  SourceId,
  SourceRecord,
} from '../types/index.ts';
import {
  BUILT_IN_FIELD_KEYS,
  fieldKeyToSql,
  getEntryFieldValue,
  isBuiltInFieldKey,
} from './field-key.ts';

describe('fieldKeyToSql', () => {
  it.each([
    ['@ts',         'entry.ts',         false],
    ['@level',      'entry.level',      false],
    ['@seq',        'entry.seq',        false],
    ['@file',       'entry.file_path',  false],
    ['@byte_start', 'entry.byte_start', false],
    ['@byte_end',   'entry.byte_end',   false],
    ['@source.id',  'entry.source_id',  false],
  ] as const)('built-in %s → entry column (no source JOIN)', (key, sql, joinFlag) => {
    expect(fieldKeyToSql(key)).toEqual({ sql, needsSourceJoin: joinFlag });
  });

  it.each([
    ['@source.name', 'source.name'],
    ['@source.kind', 'source.kind'],
  ])('built-in %s → source column (needs JOIN)', (key, sql) => {
    expect(fieldKeyToSql(key)).toEqual({ sql, needsSourceJoin: true });
  });

  it('dynamic key → JSON_EXTRACT against fields_json', () => {
    expect(fieldKeyToSql('trace_id')).toEqual({
      sql: "JSON_EXTRACT(entry.fields_json, '$.trace_id')",
      needsSourceJoin: false,
    });
  });

  it('positional $-key → bracket-quoted JSONPath (plain-text tokens)', () => {
    expect(fieldKeyToSql('$0')).toEqual({
      sql: `JSON_EXTRACT(entry.fields_json, '$["$0"]')`,
      needsSourceJoin: false,
    });
    expect(fieldKeyToSql('$42')).toEqual({
      sql: `JSON_EXTRACT(entry.fields_json, '$["$42"]')`,
      needsSourceJoin: false,
    });
  });

  it('throws on unknown @-prefix to surface UI typos early', () => {
    expect(() => fieldKeyToSql('@nope')).toThrow(/unknown built-in/i);
  });

  it('throws on dynamic key with disallowed characters', () => {
    expect(() => fieldKeyToSql('weird key')).toThrow(/invalid dynamic/i);
    expect(() => fieldKeyToSql("inj'ect")).toThrow(/invalid dynamic/i);
    expect(() => fieldKeyToSql('1leading')).toThrow(/invalid dynamic/i);
    expect(() => fieldKeyToSql('with.dot')).toThrow(/invalid dynamic/i);
    // $-keys must be `$\d+` exactly — not arbitrary `$foo`.
    expect(() => fieldKeyToSql('$abc')).toThrow(/invalid dynamic/i);
    expect(() => fieldKeyToSql('$')).toThrow(/invalid dynamic/i);
  });

  it('isBuiltInFieldKey reflects the table', () => {
    expect(isBuiltInFieldKey('@ts')).toBe(true);
    expect(isBuiltInFieldKey('@source.name')).toBe(true);
    expect(isBuiltInFieldKey('trace_id')).toBe(false);
    expect(isBuiltInFieldKey('@bogus')).toBe(false);
  });

  it('BUILT_IN_FIELD_KEYS lists every supported @-key', () => {
    expect(BUILT_IN_FIELD_KEYS).toEqual([
      '@ts',
      '@level',
      '@seq',
      '@file',
      '@byte_start',
      '@byte_end',
      '@source.id',
      '@source.name',
      '@source.kind',
    ]);
  });
});

describe('getEntryFieldValue', () => {
  const entry: LogEntry = {
    id: 'e1' as EntryId,
    sourceId: 's1' as SourceId,
    seq: 7,
    timestamp: 1234,
    level: 'warn',
    message: 'hi',
    raw: 'raw',
    fields: { trace_id: 't', status: 500 },
    filePath: 'a.log',
    byteStart: 100,
    byteEnd: 150,
    lineNumber: 5,
    fileSeq: 3,
  };
  const sourceRecord: SourceRecord = {
    source: { id: 's1' as SourceId, kind: 'text', name: 'a.log', text: '' },
    status: { kind: 'idle' },
  };

  it.each([
    ['@ts',         1234],
    ['@level',      'warn'],
    ['@seq',        7],
    ['@file',       'a.log'],
    ['@byte_start', 100],
    ['@byte_end',   150],
    ['@source.id',  's1'],
  ] as const)('built-in %s pulls from entry', (key, expected) => {
    expect(getEntryFieldValue(entry, key)).toBe(expected);
  });

  it('@source.name / @source.kind use the SourceRecord lookup', () => {
    expect(getEntryFieldValue(entry, '@source.name', sourceRecord)).toBe('a.log');
    expect(getEntryFieldValue(entry, '@source.kind', sourceRecord)).toBe('text');
  });

  it('@source.* return null when no record is supplied', () => {
    expect(getEntryFieldValue(entry, '@source.name')).toBeNull();
    expect(getEntryFieldValue(entry, '@source.kind', null)).toBeNull();
  });

  it('dynamic key reads entry.fields', () => {
    expect(getEntryFieldValue(entry, 'trace_id')).toBe('t');
    expect(getEntryFieldValue(entry, 'status')).toBe(500);
    expect(getEntryFieldValue(entry, 'missing')).toBeUndefined();
  });

  it('unknown @-key returns null (mirrors fieldKeyToSql throwing)', () => {
    expect(getEntryFieldValue(entry, '@nope')).toBeNull();
  });
});

describe('fieldKeyToSql / ~-namespace (logical fields)', () => {
  const traceField: LogicalField = {
    id: 'trace_id',
    type: 'string',
    label: 'Trace id',
    origin: 'user',
    extractors: [
      { type: 'field', path: 'trace_id' },
      { type: 'field', path: 'traceId' },
    ],
  };

  it('expands a known ~key into the field chain via logicalFieldToSql', () => {
    expect(
      fieldKeyToSql('~trace_id', { activeLogicalFields: [traceField] }),
    ).toEqual({
      sql:
        'COALESCE(' +
        "JSON_EXTRACT(entry.fields_json, '$.trace_id'), " +
        "JSON_EXTRACT(entry.fields_json, '$.traceId')" +
        ')',
      needsSourceJoin: false,
    });
  });

  it('returns SQL NULL when no ctx is supplied', () => {
    expect(fieldKeyToSql('~trace_id')).toEqual({
      sql: 'NULL',
      needsSourceJoin: false,
    });
  });

  it('returns SQL NULL when the ~id is not active', () => {
    expect(
      fieldKeyToSql('~trace_id', { activeLogicalFields: [] }),
    ).toEqual({ sql: 'NULL', needsSourceJoin: false });
  });
});

describe('getEntryFieldValue / ~-namespace (logical fields)', () => {
  const traceField: LogicalField = {
    id: 'trace_id',
    type: 'string',
    label: 'Trace id',
    origin: 'user',
    extractors: [
      { type: 'field', path: 'trace_id' },
      { type: 'field', path: 'traceId' },
    ],
  };
  const entry: LogEntry = {
    id: 'e' as EntryId,
    sourceId: 's' as SourceId,
    seq: 0,
    timestamp: 0,
    level: 'info',
    message: '',
    raw: '',
    fields: { traceId: 'abc' },
    filePath: '',
    byteStart: 0,
    byteEnd: 0,
    lineNumber: 0,
    fileSeq: 0,
  };

  it('resolves the chain by id', () => {
    expect(
      getEntryFieldValue(entry, '~trace_id', null, {
        activeLogicalFields: [traceField],
      }),
    ).toBe('abc');
  });

  it('returns null without ctx', () => {
    expect(getEntryFieldValue(entry, '~trace_id')).toBeNull();
  });

  it('returns null when the active list is empty', () => {
    expect(
      getEntryFieldValue(entry, '~trace_id', null, {
        activeLogicalFields: [],
      }),
    ).toBeNull();
  });
});
