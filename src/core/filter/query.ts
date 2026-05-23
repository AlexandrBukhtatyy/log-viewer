import type {
  FieldFilter,
  FieldFilterOp,
  LogFilter,
} from '../types/log-filter.ts';
import { fieldKeyToSql, SOURCE_JOIN_SQL } from './field-key.ts';

export interface BuiltClause {
  /**
   * `JOIN source ...` when any clause references `@source.name` /
   * `@source.kind`; empty otherwise. FTS5 was retired with ADR-0016
   * (the body it indexed no longer lives in SQLite). Free-text
   * substring/regex search resolves on the read-path against the
   * visible window, not at SQL level.
   */
  readonly joinSql: string;
  /** "WHERE ..." or empty string when no constraints. */
  readonly whereSql: string;
  readonly params: ReadonlyArray<string | number>;
}

const escapeLike = (s: string): string =>
  s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');

/**
 * Translate a `LogFilter` to a SQL JOIN + WHERE clause + bind parameters.
 *
 * Shorthand fields (`levels`/`services`/`filePaths`/`sources`/`timeRange`)
 * stay on the public `LogFilter` API (backward compat sugar) but go
 * through the same `fieldKeyToSql` translator as `fieldFilters` —
 * there is exactly one place that decides "what SQL is `@level`".
 *
 * `fieldFilters[].key` accepts the full `@`-namespace; built-ins and
 * dynamic JSON-extracts are interchangeable on the wire. Operators:
 *   `=`  string equality (CAST AS TEXT)
 *   `!=` string inequality (CAST AS TEXT)
 *   `~`  case-insensitive substring (LIKE)
 *   `>`  numeric greater (CAST AS REAL)
 *   `<`  numeric less (CAST AS REAL)
 * A row whose JSON does not contain the key never matches (NULL semantics).
 *
 * Free-text `query`/`queryMode`/`wholeWord`/`caseSensitive` are
 * intentionally NOT pushed into SQL — after ADR-0016 the body lives
 * outside SQLite and the resolver matches them against decoded bytes
 * for the visible window only.
 */
export const buildClause = (filter: LogFilter): BuiltClause => {
  const conds: string[] = [];
  const params: Array<string | number> = [];
  let needsSourceJoin = false;

  const inClauseFromFieldKey = (
    key: string,
    values: ReadonlyArray<string>,
  ): void => {
    if (values.length === 0) return;
    const { sql, needsSourceJoin: join } = fieldKeyToSql(key);
    if (join) needsSourceJoin = true;
    const placeholders = values.map(() => '?').join(', ');
    conds.push(`${sql} IN (${placeholders})`);
    params.push(...values);
  };

  if (filter.levels && filter.levels.length > 0) {
    inClauseFromFieldKey('@level', filter.levels);
  }
  if (filter.sources && filter.sources.length > 0) {
    inClauseFromFieldKey('@source.id', filter.sources);
  }
  if (filter.services && filter.services.length > 0) {
    inClauseFromFieldKey('service', filter.services);
  }
  if (filter.filePaths && filter.filePaths.length > 0) {
    inClauseFromFieldKey('@file', filter.filePaths);
  }

  if (filter.timeRange) {
    const tsCol = fieldKeyToSql('@ts').sql;
    if (filter.timeRange.from !== null) {
      conds.push(`${tsCol} >= ?`);
      params.push(filter.timeRange.from);
    }
    if (filter.timeRange.to !== null) {
      conds.push(`${tsCol} <= ?`);
      params.push(filter.timeRange.to);
    }
  }

  if (filter.fieldFilters && filter.fieldFilters.length > 0) {
    for (const ff of filter.fieldFilters) {
      const fieldClause = buildFieldFilterClause(ff);
      if (fieldClause.needsSourceJoin) needsSourceJoin = true;
      conds.push(fieldClause.sql);
      params.push(...fieldClause.params);
    }
  }

  return {
    joinSql: needsSourceJoin ? SOURCE_JOIN_SQL : '',
    whereSql: conds.length === 0 ? '' : `WHERE ${conds.join(' AND ')}`,
    params,
  };
};

interface FieldClause {
  readonly sql: string;
  readonly params: ReadonlyArray<string | number>;
  readonly needsSourceJoin: boolean;
}

const buildFieldFilterClause = (ff: FieldFilter): FieldClause => {
  const { sql: lhs, needsSourceJoin } = fieldKeyToSql(ff.key);
  switch (ff.op as FieldFilterOp) {
    case '=':
      return {
        sql: `CAST(${lhs} AS TEXT) = ?`,
        params: [ff.value],
        needsSourceJoin,
      };
    case '!=':
      return {
        sql: `CAST(${lhs} AS TEXT) != ?`,
        params: [ff.value],
        needsSourceJoin,
      };
    case '~':
      return {
        sql: `LOWER(CAST(${lhs} AS TEXT)) LIKE LOWER(?) ESCAPE '\\'`,
        params: [`%${escapeLike(ff.value)}%`],
        needsSourceJoin,
      };
    case '>':
      return {
        sql: `CAST(${lhs} AS REAL) > CAST(? AS REAL)`,
        params: [ff.value],
        needsSourceJoin,
      };
    case '<':
      return {
        sql: `CAST(${lhs} AS REAL) < CAST(? AS REAL)`,
        params: [ff.value],
        needsSourceJoin,
      };
  }
};

export const ORDER_BY_TIME =
  'ORDER BY entry.ts IS NULL, entry.ts ASC, entry.source_id ASC, entry.seq ASC';

export const ORDER_BY_PHYSICAL =
  'ORDER BY entry.source_id ASC, entry.seq ASC';

/**
 * Choose the `ORDER BY` clause for entry listings.
 *
 * - Explicit `filter.orderBy` always wins — user has consciously picked an
 *   ordering, honour it.
 * - Otherwise infer from filter shape:
 *     * Single source AND at most one file path selected → `'physical'`.
 *       The user is looking at one specific file (or one source's natural
 *       walk order); `source_id ASC, seq ASC` keeps the gutter line
 *       numbers monotonic and out-of-order timestamps don't shuffle the
 *       view.
 *     * Multiple files within one source, multiple sources, or no
 *       source/path constraint at all → `'time'`. Cross-file correlation
 *       is the whole point of selecting multiple things together;
 *       grouping by `source_id` would render the view file-by-file
 *       instead of interleaved.
 */
export const orderByForFilter = (filter: LogFilter): string => {
  if (filter.orderBy === 'time') return ORDER_BY_TIME;
  if (filter.orderBy === 'physical') return ORDER_BY_PHYSICAL;
  const filePathCount = filter.filePaths?.length ?? 0;
  const sourceCount = filter.sources?.length ?? 0;
  const isSingleScope = sourceCount === 1 && filePathCount <= 1;
  return isSingleScope ? ORDER_BY_PHYSICAL : ORDER_BY_TIME;
};
