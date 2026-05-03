import type { LogFilter } from '../types/log-filter.ts';

export interface BuiltClause {
  /** "" or "JOIN entry_fts ON entry_fts.rowid = entry.rowid" — for FTS query mode. */
  readonly joinSql: string;
  /** "WHERE ..." or empty string when no constraints. */
  readonly whereSql: string;
  readonly params: ReadonlyArray<string | number>;
}

const escapeLike = (s: string): string =>
  s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');

/**
 * Translate a LogFilter to a SQL JOIN + WHERE clause + bind parameters.
 *
 * - levels / sources / timeRange — simple WHERE predicates.
 * - queryMode='substring' — LIKE with ESCAPE; respects caseSensitive.
 * - queryMode='fts' — JOIN entry_fts MATCH (FTS5 grammar; user-supplied query passed verbatim).
 * - queryMode='regex' — currently silently dropped (planned).
 */
export const buildClause = (filter: LogFilter): BuiltClause => {
  const conds: string[] = [];
  const params: Array<string | number> = [];
  let joinSql = '';

  if (filter.levels && filter.levels.length > 0) {
    const placeholders = filter.levels.map(() => '?').join(', ');
    conds.push(`level IN (${placeholders})`);
    params.push(...filter.levels);
  }

  if (filter.sources && filter.sources.length > 0) {
    const placeholders = filter.sources.map(() => '?').join(', ');
    conds.push(`source_id IN (${placeholders})`);
    params.push(...filter.sources);
  }

  if (filter.timeRange) {
    if (filter.timeRange.from !== null) {
      conds.push('ts >= ?');
      params.push(filter.timeRange.from);
    }
    if (filter.timeRange.to !== null) {
      conds.push('ts <= ?');
      params.push(filter.timeRange.to);
    }
  }

  const trimmedQuery = filter.query.trim();
  if (trimmedQuery !== '') {
    if (filter.queryMode === 'fts') {
      joinSql = 'JOIN entry_fts ON entry_fts.rowid = entry.rowid';
      conds.push('entry_fts MATCH ?');
      params.push(trimmedQuery);
    } else if (filter.queryMode === 'substring') {
      if (filter.caseSensitive) {
        conds.push("message LIKE ? ESCAPE '\\'");
      } else {
        conds.push("LOWER(message) LIKE LOWER(?) ESCAPE '\\'");
      }
      params.push(`%${escapeLike(trimmedQuery)}%`);
    }
    // queryMode='regex' — not implemented yet (planned in §11 of the architecture plan).
  }

  // fieldFilters — после MVP, через JSON_EXTRACT(fields_json, ...).

  return {
    joinSql,
    whereSql: conds.length === 0 ? '' : `WHERE ${conds.join(' AND ')}`,
    params,
  };
};

export const ORDER_BY_DEFAULT =
  'ORDER BY entry.ts IS NULL, entry.ts ASC, entry.source_id ASC, entry.seq ASC';
