import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_FIELD_KEYS,
  fieldKeyToSql,
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
