import type {
  FieldFilter,
  FieldFilterOp,
  LogFilter,
} from '../types/log-filter.ts';

export interface BuiltClause {
  /** "" or "JOIN entry_fts ON entry_fts.rowid = entry.rowid" — for FTS query mode. */
  readonly joinSql: string;
  /** "WHERE ..." or empty string when no constraints. */
  readonly whereSql: string;
  readonly params: ReadonlyArray<string | number>;
}

const escapeLike = (s: string): string =>
  s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');

/** Escape regex metacharacters so a substring query can be wrapped in \b…\b safely. */
const escapeRegex = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Translate a `LogFilter` to a SQL JOIN + WHERE clause + bind parameters.
 *
 * - `levels` / `sources` / `services` / `timeRange` — simple WHERE predicates.
 * - `services` — `JSON_EXTRACT(fields_json, '$.service') IN (...)`.
 * - `queryMode='substring'` — `LIKE` with ESCAPE; respects `caseSensitive`.
 *   When `wholeWord` is on, a Phase-1 fallback pads message with sentinel
 *   spaces and matches `' word '` — this catches word boundaries against
 *   adjacent whitespace but not against punctuation. Phase 2 (REGEXP UDF)
 *   replaces this with `\b<word>\b`.
 * - `queryMode='fts'` — JOIN entry_fts MATCH. With `wholeWord` the query is
 *   wrapped in phrase quotes (`"foo bar"`).
 * - `queryMode='regex'` — currently silently dropped (Phase 2).
 * - `fieldFilters` — translated via `JSON_EXTRACT(fields_json, '$.<key>')`.
 *   Operators:
 *     `=`  string equality (CAST AS TEXT)
 *     `!=` string inequality (CAST AS TEXT)
 *     `~`  case-insensitive substring (LIKE)
 *     `>`  numeric greater (CAST AS REAL)
 *     `<`  numeric less (CAST AS REAL)
 *   A row whose JSON does not contain the key never matches (NULL semantics).
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

  if (filter.services && filter.services.length > 0) {
    const placeholders = filter.services.map(() => '?').join(', ');
    conds.push(
      `JSON_EXTRACT(fields_json, '$.service') IN (${placeholders})`,
    );
    params.push(...filter.services);
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
      params.push(filter.wholeWord ? `"${trimmedQuery}"` : trimmedQuery);
    } else if (filter.queryMode === 'regex') {
      // Case sensitivity selects between regexp/regexpi UDFs (see open-db.ts).
      const fn = filter.caseSensitive ? 'regexp' : 'regexpi';
      const pattern = filter.wholeWord ? `\\b(?:${trimmedQuery})\\b` : trimmedQuery;
      conds.push(`${fn}(?, message)`);
      params.push(pattern);
    } else {
      // queryMode === 'substring'.
      // wholeWord uses regex \b…\b for proper word boundaries (handles
      // punctuation), with the user's input regex-escaped so it matches
      // literally. Otherwise — LIKE (with case folding when not caseSensitive).
      if (filter.wholeWord) {
        const fn = filter.caseSensitive ? 'regexp' : 'regexpi';
        conds.push(`${fn}(?, message)`);
        params.push(`\\b${escapeRegex(trimmedQuery)}\\b`);
      } else {
        const pattern = `%${escapeLike(trimmedQuery)}%`;
        if (filter.caseSensitive) {
          conds.push("message LIKE ? ESCAPE '\\'");
        } else {
          conds.push("LOWER(message) LIKE LOWER(?) ESCAPE '\\'");
        }
        params.push(pattern);
      }
    }
  }

  if (filter.fieldFilters && filter.fieldFilters.length > 0) {
    for (const ff of filter.fieldFilters) {
      const fieldClause = buildFieldFilterClause(ff);
      conds.push(fieldClause.sql);
      params.push(...fieldClause.params);
    }
  }

  return {
    joinSql,
    whereSql: conds.length === 0 ? '' : `WHERE ${conds.join(' AND ')}`,
    params,
  };
};

interface FieldClause {
  readonly sql: string;
  readonly params: ReadonlyArray<string | number>;
}

const buildFieldFilterClause = (ff: FieldFilter): FieldClause => {
  const path = `$.${ff.key}`;
  const extract = "JSON_EXTRACT(fields_json, ?)";
  switch (ff.op as FieldFilterOp) {
    case '=':
      return {
        sql: `CAST(${extract} AS TEXT) = ?`,
        params: [path, ff.value],
      };
    case '!=':
      return {
        sql: `CAST(${extract} AS TEXT) != ?`,
        params: [path, ff.value],
      };
    case '~':
      return {
        sql: `LOWER(CAST(${extract} AS TEXT)) LIKE LOWER(?) ESCAPE '\\'`,
        params: [path, `%${escapeLike(ff.value)}%`],
      };
    case '>':
      return {
        sql: `CAST(${extract} AS REAL) > CAST(? AS REAL)`,
        params: [path, ff.value],
      };
    case '<':
      return {
        sql: `CAST(${extract} AS REAL) < CAST(? AS REAL)`,
        params: [path, ff.value],
      };
  }
};

export const ORDER_BY_DEFAULT =
  'ORDER BY entry.ts IS NULL, entry.ts ASC, entry.source_id ASC, entry.seq ASC';
