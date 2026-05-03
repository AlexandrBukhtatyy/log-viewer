import { describe, expect, it } from 'vitest';
import {
  ALL_LEVELS,
  collectLevelCounts,
  groupFieldExpr,
  levelBreakdownSql,
} from './aggregate.ts';

describe('groupFieldExpr', () => {
  it('maps `level` to the entry column directly (no JSON parse)', () => {
    expect(groupFieldExpr('level')).toBe('entry.level');
  });

  it('maps `source_id` to the entry column', () => {
    expect(groupFieldExpr('source_id')).toBe('entry.source_id');
  });

  it('maps other identifiers to JSON_EXTRACT on fields_json', () => {
    expect(groupFieldExpr('service')).toBe(
      "JSON_EXTRACT(entry.fields_json, '$.service')",
    );
    expect(groupFieldExpr('trace_id')).toBe(
      "JSON_EXTRACT(entry.fields_json, '$.trace_id')",
    );
  });

  it('rejects identifiers with metacharacters to prevent SQL injection', () => {
    expect(() => groupFieldExpr("foo'); DROP TABLE entry;--")).toThrow(/invalid group field/);
    expect(() => groupFieldExpr('foo bar')).toThrow();
    expect(() => groupFieldExpr('123_starts_digit')).toThrow();
    expect(() => groupFieldExpr('')).toThrow();
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
