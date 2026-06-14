import { describe, expect, it } from 'vitest';
import type { LogicalField } from '../types/index.ts';
import { logicalFieldToSql } from './sql.ts';

const field = (
  id: string,
  extractors: LogicalField['extractors'],
): LogicalField => ({
  id,
  type: 'string',
  label: id,
  origin: 'user',
  extractors,
});

describe('logicalFieldToSql', () => {
  it('single field extractor → bare JSON_EXTRACT', () => {
    expect(
      logicalFieldToSql(
        field('trace_id', [{ type: 'field', path: 'trace_id' }]),
      ),
    ).toEqual({
      sql: "JSON_EXTRACT(entry.fields_json, '$.trace_id')",
      needsSourceJoin: false,
    });
  });

  it('multiple field extractors → COALESCE chain', () => {
    expect(
      logicalFieldToSql(
        field('trace_id', [
          { type: 'field', path: 'trace_id' },
          { type: 'field', path: 'traceId' },
          { type: 'field', path: 'tid' },
        ]),
      ),
    ).toEqual({
      sql:
        'COALESCE(' +
        "JSON_EXTRACT(entry.fields_json, '$.trace_id'), " +
        "JSON_EXTRACT(entry.fields_json, '$.traceId'), " +
        "JSON_EXTRACT(entry.fields_json, '$.tid')" +
        ')',
      needsSourceJoin: false,
    });
  });

  it('nested dot path produces $.a.b JSON-path', () => {
    expect(
      logicalFieldToSql(
        field('http.status', [{ type: 'field', path: 'http.status_code' }]),
      ),
    ).toEqual({
      sql: "JSON_EXTRACT(entry.fields_json, '$.http.status_code')",
      needsSourceJoin: false,
    });
  });

  it('silently skips regex extractors in Phase 1 (UDF lands in 1.6)', () => {
    expect(
      logicalFieldToSql(
        field('trace_id', [
          { type: 'field', path: 'trace_id' },
          { type: 'regex', on: 'message', pattern: 'tr=(\\w+)' },
        ]),
      ),
    ).toEqual({
      sql: "JSON_EXTRACT(entry.fields_json, '$.trace_id')",
      needsSourceJoin: false,
    });
  });

  it('only regex extractors → NULL placeholder', () => {
    expect(
      logicalFieldToSql(
        field('trace_id', [
          { type: 'regex', on: 'message', pattern: 'tr=(\\w+)' },
        ]),
      ),
    ).toEqual({ sql: 'NULL', needsSourceJoin: false });
  });

  it('empty extractor chain → NULL placeholder', () => {
    expect(logicalFieldToSql(field('empty', []))).toEqual({
      sql: 'NULL',
      needsSourceJoin: false,
    });
  });

  it('drops paths with non-identifier segments to keep SQL non-injectable', () => {
    expect(
      logicalFieldToSql(
        field('bad', [
          { type: 'field', path: "x'); DROP TABLE entry; --" },
          { type: 'field', path: 'has space' },
          { type: 'field', path: '' },
          { type: 'field', path: 'ok' },
        ]),
      ),
    ).toEqual({
      sql: "JSON_EXTRACT(entry.fields_json, '$.ok')",
      needsSourceJoin: false,
    });
  });

  it('regex-on-json compiles to regexp_extract_group UDF call', () => {
    expect(
      logicalFieldToSql(
        field('trace_id', [
          {
            type: 'regex-on-json',
            path: 'context',
            pattern: 'tr=(?<v>\\w+)',
            flags: 'i',
            group: 'v',
          },
        ]),
      ),
    ).toEqual({
      sql:
        `regexp_extract_group('tr=(?<v>\\w+)', ` +
        `JSON_EXTRACT(entry.fields_json, '$.context'), ` +
        `'v', 'i')`,
      needsSourceJoin: false,
    });
  });

  it('regex-on-json escapes single quotes in pattern/group/flags', () => {
    expect(
      logicalFieldToSql(
        field('odd', [
          {
            type: 'regex-on-json',
            path: 'ctx',
            pattern: "X'1",
            group: "g'1",
            flags: "i'",
          },
        ]),
      ).sql,
    ).toContain("'X''1'");
  });

  it('mixed chain combines field, regex-on-json, skips regex', () => {
    expect(
      logicalFieldToSql(
        field('trace_id', [
          { type: 'field', path: 'trace_id' },
          {
            type: 'regex-on-json',
            path: 'ctx',
            pattern: 'tr=(\\w+)',
          },
          { type: 'regex', on: 'message', pattern: 'tr=(\\w+)' },
        ]),
      ).sql,
    ).toBe(
      `COALESCE(JSON_EXTRACT(entry.fields_json, '$.trace_id'), ` +
        `regexp_extract_group('tr=(\\w+)', ` +
        `JSON_EXTRACT(entry.fields_json, '$.ctx'), '', ''))`,
    );
  });
});
