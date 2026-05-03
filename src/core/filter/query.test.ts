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

  it('levels filter generates IN clause', () => {
    const built = buildClause(f({ levels: ['error', 'fatal'] }));
    expect(built.whereSql).toBe('WHERE level IN (?, ?)');
    expect(built.params).toEqual(['error', 'fatal']);
    expect(built.joinSql).toBe('');
  });

  it('sources filter generates IN clause', () => {
    const built = buildClause(
      f({ sources: ['s-1' as SourceId, 's-2' as SourceId] }),
    );
    expect(built.whereSql).toBe('WHERE source_id IN (?, ?)');
    expect(built.params).toEqual(['s-1', 's-2']);
  });

  it('time range with both bounds', () => {
    const built = buildClause(
      f({ timeRange: { from: 1000, to: 2000 } }),
    );
    expect(built.whereSql).toBe('WHERE ts >= ? AND ts <= ?');
    expect(built.params).toEqual([1000, 2000]);
  });

  it('time range with only "from" bound', () => {
    const built = buildClause(f({ timeRange: { from: 1000, to: null } }));
    expect(built.whereSql).toBe('WHERE ts >= ?');
    expect(built.params).toEqual([1000]);
  });

  it('substring query (case-insensitive default)', () => {
    const built = buildClause(f({ query: 'error', queryMode: 'substring' }));
    expect(built.whereSql).toBe(
      "WHERE LOWER(message) LIKE LOWER(?) ESCAPE '\\'",
    );
    expect(built.params).toEqual(['%error%']);
  });

  it('substring query (case-sensitive)', () => {
    const built = buildClause(
      f({ query: 'Error', queryMode: 'substring', caseSensitive: true }),
    );
    expect(built.whereSql).toBe("WHERE message LIKE ? ESCAPE '\\'");
    expect(built.params).toEqual(['%Error%']);
  });

  it('substring query escapes LIKE-special chars', () => {
    const built = buildClause(
      f({ query: '50%_off', queryMode: 'substring', caseSensitive: true }),
    );
    expect(built.params).toEqual(['%50\\%\\_off%']);
  });

  it('FTS query produces JOIN + MATCH', () => {
    const built = buildClause(
      f({ query: 'memory OR exception', queryMode: 'fts' }),
    );
    expect(built.joinSql).toBe(
      'JOIN entry_fts ON entry_fts.rowid = entry.rowid',
    );
    expect(built.whereSql).toBe('WHERE entry_fts MATCH ?');
    expect(built.params).toEqual(['memory OR exception']);
  });

  it('regex queryMode case-insensitive uses regexpi UDF', () => {
    const built = buildClause(f({ query: 'err.*o', queryMode: 'regex' }));
    expect(built.whereSql).toBe('WHERE regexpi(?, message)');
    expect(built.params).toEqual(['err.*o']);
  });

  it('regex queryMode case-sensitive uses regexp UDF', () => {
    const built = buildClause(
      f({ query: 'Err.*o', queryMode: 'regex', caseSensitive: true }),
    );
    expect(built.whereSql).toBe('WHERE regexp(?, message)');
    expect(built.params).toEqual(['Err.*o']);
  });

  it('regex + wholeWord wraps user pattern in \\b(?:...)\\b', () => {
    const built = buildClause(
      f({ query: 'foo|bar', queryMode: 'regex', wholeWord: true }),
    );
    expect(built.whereSql).toBe('WHERE regexpi(?, message)');
    expect(built.params).toEqual(['\\b(?:foo|bar)\\b']);
  });

  it('services filter generates JSON_EXTRACT IN clause', () => {
    const built = buildClause(f({ services: ['api-gateway', 'billing'] }));
    expect(built.whereSql).toBe(
      "WHERE JSON_EXTRACT(fields_json, '$.service') IN (?, ?)",
    );
    expect(built.params).toEqual(['api-gateway', 'billing']);
  });

  it('wholeWord substring uses regexpi UDF with \\b…\\b (case-insensitive)', () => {
    const built = buildClause(
      f({ query: 'foo', queryMode: 'substring', wholeWord: true }),
    );
    expect(built.whereSql).toBe('WHERE regexpi(?, message)');
    expect(built.params).toEqual(['\\bfoo\\b']);
  });

  it('wholeWord substring uses regexp UDF when case-sensitive', () => {
    const built = buildClause(
      f({
        query: 'Foo',
        queryMode: 'substring',
        wholeWord: true,
        caseSensitive: true,
      }),
    );
    expect(built.whereSql).toBe('WHERE regexp(?, message)');
    expect(built.params).toEqual(['\\bFoo\\b']);
  });

  it('wholeWord substring escapes regex metacharacters in user input', () => {
    const built = buildClause(
      f({ query: 'a.b+c', queryMode: 'substring', wholeWord: true }),
    );
    expect(built.params).toEqual(['\\ba\\.b\\+c\\b']);
  });

  it('wholeWord with FTS wraps query in phrase quotes', () => {
    const built = buildClause(
      f({ query: 'memory leak', queryMode: 'fts', wholeWord: true }),
    );
    expect(built.params).toEqual(['"memory leak"']);
  });

  it('fieldFilter `=` produces CAST AS TEXT equality', () => {
    const built = buildClause(
      f({ fieldFilters: [{ key: 'status', op: '=', value: '500' }] }),
    );
    expect(built.whereSql).toBe(
      'WHERE CAST(JSON_EXTRACT(fields_json, ?) AS TEXT) = ?',
    );
    expect(built.params).toEqual(['$.status', '500']);
  });

  it('fieldFilter `!=` produces CAST AS TEXT inequality', () => {
    const built = buildClause(
      f({ fieldFilters: [{ key: 'env', op: '!=', value: 'prod' }] }),
    );
    expect(built.whereSql).toBe(
      'WHERE CAST(JSON_EXTRACT(fields_json, ?) AS TEXT) != ?',
    );
    expect(built.params).toEqual(['$.env', 'prod']);
  });

  it('fieldFilter `~` produces case-insensitive LIKE on extracted value', () => {
    const built = buildClause(
      f({ fieldFilters: [{ key: 'path', op: '~', value: '/v1/orders' }] }),
    );
    expect(built.whereSql).toBe(
      "WHERE LOWER(CAST(JSON_EXTRACT(fields_json, ?) AS TEXT)) LIKE LOWER(?) ESCAPE '\\'",
    );
    expect(built.params).toEqual(['$.path', '%/v1/orders%']);
  });

  it('fieldFilter `>` produces numeric CAST AS REAL', () => {
    const built = buildClause(
      f({ fieldFilters: [{ key: 'duration_ms', op: '>', value: '1000' }] }),
    );
    expect(built.whereSql).toBe(
      'WHERE CAST(JSON_EXTRACT(fields_json, ?) AS REAL) > CAST(? AS REAL)',
    );
    expect(built.params).toEqual(['$.duration_ms', '1000']);
  });

  it('fieldFilter `<` produces numeric CAST AS REAL', () => {
    const built = buildClause(
      f({ fieldFilters: [{ key: 'status', op: '<', value: '500' }] }),
    );
    expect(built.whereSql).toBe(
      'WHERE CAST(JSON_EXTRACT(fields_json, ?) AS REAL) < CAST(? AS REAL)',
    );
    expect(built.params).toEqual(['$.status', '500']);
  });

  it('combines all clauses with AND', () => {
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
    expect(built.joinSql).toBe(
      'JOIN entry_fts ON entry_fts.rowid = entry.rowid',
    );
    expect(built.whereSql).toBe(
      'WHERE level IN (?)' +
        ' AND source_id IN (?)' +
        " AND JSON_EXTRACT(fields_json, '$.service') IN (?)" +
        ' AND ts >= ?' +
        ' AND entry_fts MATCH ?' +
        ' AND CAST(JSON_EXTRACT(fields_json, ?) AS REAL) > CAST(? AS REAL)',
    );
    expect(built.params).toEqual([
      'error',
      's-1',
      'billing',
      1000,
      'fail',
      '$.status',
      '499',
    ]);
  });

  it('empty query string skips query predicate even in fts mode', () => {
    const built = buildClause(f({ query: '   ', queryMode: 'fts' }));
    expect(built.joinSql).toBe('');
    expect(built.whereSql).toBe('');
  });
});

describe('ORDER_BY_DEFAULT', () => {
  it('uses qualified entry.* columns for FTS-JOIN compatibility', () => {
    expect(ORDER_BY_DEFAULT).toContain('entry.ts');
    expect(ORDER_BY_DEFAULT).toContain('entry.source_id');
    expect(ORDER_BY_DEFAULT).toContain('entry.seq');
    expect(ORDER_BY_DEFAULT).toContain('IS NULL'); // null timestamps go last
  });
});
