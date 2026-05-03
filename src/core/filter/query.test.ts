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

  it('regex queryMode is silently dropped (planned but not implemented)', () => {
    const built = buildClause(f({ query: '.*', queryMode: 'regex' }));
    expect(built.whereSql).toBe('');
    expect(built.params).toEqual([]);
  });

  it('combines all clauses with AND', () => {
    const built = buildClause(
      f({
        levels: ['error'],
        sources: ['s-1' as SourceId],
        timeRange: { from: 1000, to: null },
        query: 'fail',
        queryMode: 'fts',
      }),
    );
    expect(built.joinSql).toBe(
      'JOIN entry_fts ON entry_fts.rowid = entry.rowid',
    );
    expect(built.whereSql).toBe(
      'WHERE level IN (?) AND source_id IN (?) AND ts >= ? AND entry_fts MATCH ?',
    );
    expect(built.params).toEqual(['error', 's-1', 1000, 'fail']);
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
