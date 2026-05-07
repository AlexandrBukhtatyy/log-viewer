import { describe, expect, it } from 'vitest';
import type {
  EntryId,
  LogEntry,
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

  it('throws on unknown @-prefix to surface UI typos early', () => {
    expect(() => fieldKeyToSql('@nope')).toThrow(/unknown built-in/i);
  });

  it('throws on dynamic key with disallowed characters', () => {
    expect(() => fieldKeyToSql('weird key')).toThrow(/invalid dynamic/i);
    expect(() => fieldKeyToSql("inj'ect")).toThrow(/invalid dynamic/i);
    expect(() => fieldKeyToSql('1leading')).toThrow(/invalid dynamic/i);
    expect(() => fieldKeyToSql('with.dot')).toThrow(/invalid dynamic/i);
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
