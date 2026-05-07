import { describe, expect, it } from 'vitest';
import {
  ALL_LEVELS,
  collectLevelCounts,
  groupFieldExpr,
  levelBreakdownSql,
} from './aggregate.ts';

describe('groupFieldExpr', () => {
  it('legacy `level` maps onto @level translator (entry column)', () => {
    expect(groupFieldExpr('level')).toEqual({
      sql: 'entry.level',
      needsSourceJoin: false,
    });
  });

  it('legacy `source_id` maps onto @source.id translator', () => {
    expect(groupFieldExpr('source_id')).toEqual({
      sql: 'entry.source_id',
      needsSourceJoin: false,
    });
  });

  it('@-prefixed built-in goes straight to translator', () => {
    expect(groupFieldExpr('@ts')).toEqual({
      sql: 'entry.ts',
      needsSourceJoin: false,
    });
    expect(groupFieldExpr('@source.kind')).toEqual({
      sql: 'source.kind',
      needsSourceJoin: true,
    });
  });

  it('dynamic identifiers fall through to JSON_EXTRACT', () => {
    expect(groupFieldExpr('service')).toEqual({
      sql: "JSON_EXTRACT(entry.fields_json, '$.service')",
      needsSourceJoin: false,
    });
    expect(groupFieldExpr('trace_id')).toEqual({
      sql: "JSON_EXTRACT(entry.fields_json, '$.trace_id')",
      needsSourceJoin: false,
    });
  });

  it('rejects identifiers with metacharacters to prevent SQL injection', () => {
    expect(() => groupFieldExpr("foo'); DROP TABLE entry;--")).toThrow();
    expect(() => groupFieldExpr('foo bar')).toThrow();
    expect(() => groupFieldExpr('123_starts_digit')).toThrow();
    expect(() => groupFieldExpr('')).toThrow();
  });

  it('rejects unknown @-prefix to surface UI typos early', () => {
    expect(() => groupFieldExpr('@nope')).toThrow(/unknown built-in/i);
  });
});

describe('levelBreakdownSql', () => {
  it('emits one CASE column per known level with binds in order', () => {
    const { columns, binds } = levelBreakdownSql();
    for (const lvl of ALL_LEVELS) {
      expect(columns).toContain(`AS lc_${lvl}`);
    }
    expect(binds).toEqual(ALL_LEVELS as readonly string[]);
    expect(columns.split(',').length).toBe(ALL_LEVELS.length);
  });
});

describe('collectLevelCounts', () => {
  it('keeps only positive counts and casts to number', () => {
    const out = collectLevelCounts({
      lc_trace: 0,
      lc_debug: 0,
      lc_info: 12,
      lc_warn: 3,
      lc_error: 1,
      lc_fatal: 0,
      lc_unknown: 0,
    });
    expect(out).toEqual({ info: 12, warn: 3, error: 1 });
  });

  it('treats missing keys as zero', () => {
    expect(collectLevelCounts({})).toEqual({});
  });
});
