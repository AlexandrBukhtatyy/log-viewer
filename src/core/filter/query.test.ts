import { describe, expect, it } from 'vitest';
import type { LogFilter } from '../types/log-filter.ts';
import { EMPTY_FILTER } from '../types/log-filter.ts';
import type { SourceId } from '../types/log-entry.ts';
import { buildClause, ORDER_BY_DEFAULT } from './query.ts';

const f = (overrides: Partial<LogFilter> = {}): LogFilter => ({
  ...EMPTY_FILTER,
  ...overrides,
});

describe('buildClause', () => {
  it('empty filter → empty WHERE and JOIN', () => {
    const built = buildClause(EMPTY_FILTER);
    expect(built.whereSql).toBe('');
    expect(built.joinSql).toBe('');
    expect(built.params).toEqual([]);
  });

  it('levels filter routes through @level translator', () => {
    const built = buildClause(f({ levels: ['error', 'fatal'] }));
    expect(built.whereSql).toBe('WHERE entry.level IN (?, ?)');
    expect(built.params).toEqual(['error', 'fatal']);
    expect(built.joinSql).toBe('');
  });

  it('sources filter routes through @source.id translator', () => {
    const built = buildClause(
      f({ sources: ['s-1' as SourceId, 's-2' as SourceId] }),
    );
    expect(built.whereSql).toBe('WHERE entry.source_id IN (?, ?)');
    expect(built.params).toEqual(['s-1', 's-2']);
    expect(built.joinSql).toBe('');
  });

  it('time range with both bounds uses entry.ts', () => {
    const built = buildClause(f({ timeRange: { from: 1000, to: 2000 } }));
    expect(built.whereSql).toBe('WHERE entry.ts >= ? AND entry.ts <= ?');
    expect(built.params).toEqual([1000, 2000]);
  });

  it('time range with only "from" bound', () => {
    const built = buildClause(f({ timeRange: { from: 1000, to: null } }));
    expect(built.whereSql).toBe('WHERE entry.ts >= ?');
    expect(built.params).toEqual([1000]);
  });

  describe('free-text query never enters SQL after ADR-0016', () => {
    // FTS5 was retired and the body no longer lives in SQLite; the
    // resolver matches `query`/`queryMode`/`wholeWord`/`caseSensitive`
    // against decoded body bytes for the visible window. buildClause must
    // therefore ignore them entirely, regardless of the mode.
    it.each([
      'substring',
      'fts',
      'regex',
    ] as const)('queryMode=%s does not contribute to WHERE/JOIN', (mode) => {
      const built = buildClause(
        f({ query: 'something', queryMode: mode, wholeWord: true }),
      );
      expect(built.joinSql).toBe('');
      expect(built.whereSql).toBe('');
      expect(built.params).toEqual([]);
    });
  });

  it('filePaths filter routes through @file (entry.file_path column)', () => {
    const built = buildClause(f({ filePaths: ['app.log', 'sub/b.log'] }));
    expect(built.whereSql).toBe('WHERE entry.file_path IN (?, ?)');
    expect(built.params).toEqual(['app.log', 'sub/b.log']);
  });

  it('services filter still uses JSON_EXTRACT (dynamic key)', () => {
    const built = buildClause(f({ services: ['api-gateway', 'billing'] }));
    expect(built.whereSql).toBe(
      "WHERE JSON_EXTRACT(entry.fields_json, '$.service') IN (?, ?)",
    );
    expect(built.params).toEqual(['api-gateway', 'billing']);
  });

  describe('fieldFilters via @-namespace', () => {
    it('@-built-in key resolves to entry column with no JSON_EXTRACT', () => {
      const built = buildClause(
        f({ fieldFilters: [{ key: '@level', op: '=', value: 'error' }] }),
      );
      expect(built.whereSql).toBe(
        'WHERE CAST(entry.level AS TEXT) = ?',
      );
      expect(built.params).toEqual(['error']);
      expect(built.joinSql).toBe('');
    });

    it('@source.name triggers JOIN source', () => {
      const built = buildClause(
        f({ fieldFilters: [{ key: '@source.name', op: '~', value: 'api' }] }),
      );
      expect(built.joinSql).toBe('JOIN source ON source.id = entry.source_id');
      expect(built.whereSql).toBe(
        "WHERE LOWER(CAST(source.name AS TEXT)) LIKE LOWER(?) ESCAPE '\\'",
      );
      expect(built.params).toEqual(['%api%']);
    });

    it('dynamic key still produces JSON_EXTRACT', () => {
      const built = buildClause(
        f({ fieldFilters: [{ key: 'status', op: '=', value: '500' }] }),
      );
      expect(built.whereSql).toBe(
        "WHERE CAST(JSON_EXTRACT(entry.fields_json, '$.status') AS TEXT) = ?",
      );
      expect(built.params).toEqual(['500']);
    });
  });

  it('fieldFilter `=` with dynamic key (status)', () => {
    const built = buildClause(
      f({ fieldFilters: [{ key: 'status', op: '=', value: '500' }] }),
    );
    expect(built.whereSql).toBe(
      "WHERE CAST(JSON_EXTRACT(entry.fields_json, '$.status') AS TEXT) = ?",
    );
    expect(built.params).toEqual(['500']);
  });

  it('fieldFilter `!=` with dynamic key', () => {
    const built = buildClause(
      f({ fieldFilters: [{ key: 'env', op: '!=', value: 'prod' }] }),
    );
    expect(built.whereSql).toBe(
      "WHERE CAST(JSON_EXTRACT(entry.fields_json, '$.env') AS TEXT) != ?",
    );
    expect(built.params).toEqual(['prod']);
  });

  it('fieldFilter `~` is case-insensitive LIKE on the resolved expression', () => {
    const built = buildClause(
      f({ fieldFilters: [{ key: 'path', op: '~', value: '/v1/orders' }] }),
    );
    expect(built.whereSql).toBe(
      "WHERE LOWER(CAST(JSON_EXTRACT(entry.fields_json, '$.path') AS TEXT)) LIKE LOWER(?) ESCAPE '\\'",
    );
    expect(built.params).toEqual(['%/v1/orders%']);
  });

  it('fieldFilter `>` produces numeric CAST AS REAL', () => {
    const built = buildClause(
      f({ fieldFilters: [{ key: 'duration_ms', op: '>', value: '1000' }] }),
    );
    expect(built.whereSql).toBe(
      "WHERE CAST(JSON_EXTRACT(entry.fields_json, '$.duration_ms') AS REAL) > CAST(? AS REAL)",
    );
    expect(built.params).toEqual(['1000']);
  });

  it('fieldFilter `<` produces numeric CAST AS REAL', () => {
    const built = buildClause(
      f({ fieldFilters: [{ key: 'status', op: '<', value: '500' }] }),
    );
    expect(built.whereSql).toBe(
      "WHERE CAST(JSON_EXTRACT(entry.fields_json, '$.status') AS REAL) < CAST(? AS REAL)",
    );
    expect(built.params).toEqual(['500']);
  });

  it('combines structural clauses with AND (free-text still excluded)', () => {
    const built = buildClause(
      f({
        levels: ['error'],
        sources: ['s-1' as SourceId],
        services: ['billing'],
        timeRange: { from: 1000, to: null },
        query: 'fail',
        queryMode: 'fts',
        fieldFilters: [{ key: 'status', op: '>', value: '499' }],
      }),
    );
    expect(built.joinSql).toBe('');
    expect(built.whereSql).toBe(
      'WHERE entry.level IN (?)' +
        ' AND entry.source_id IN (?)' +
        " AND JSON_EXTRACT(entry.fields_json, '$.service') IN (?)" +
        ' AND entry.ts >= ?' +
        " AND CAST(JSON_EXTRACT(entry.fields_json, '$.status') AS REAL) > CAST(? AS REAL)",
    );
    expect(built.params).toEqual([
      'error',
      's-1',
      'billing',
      1000,
      '499',
    ]);
  });
});

describe('ORDER_BY_DEFAULT', () => {
  it('orders rows by qualified entry.* columns and puts NULL ts last', () => {
    expect(ORDER_BY_DEFAULT).toContain('entry.ts');
    expect(ORDER_BY_DEFAULT).toContain('entry.source_id');
    expect(ORDER_BY_DEFAULT).toContain('entry.seq');
    expect(ORDER_BY_DEFAULT).toContain('IS NULL');
  });
});
