import type { LogicalExtractor, LogicalField } from '../types/logical-field.ts';

/**
 * Translate a `LogicalField` into a SQL value expression equivalent to
 * the read-path resolver: try each extractor in order, the first
 * non-null wins (COALESCE).
 *
 * Two extractor types compile to SQL:
 *  - `field`         → `JSON_EXTRACT(entry.fields_json, '$.<path>')`
 *  - `regex-on-json` → `regexp_extract_group(JSON_EXTRACT(...), ...)`
 *    via the UDF installed in `open-db.ts`.
 *
 * `regex`-type extractors target `entry.message` / `entry.raw`, which
 * are NOT materialised in SQLite after ADR-0016 (the body lives
 * behind a lazy byte-pointer). They are silently skipped here and
 * only run on the read-path resolver — so a `~`-field defined purely
 * as `regex(message=…)` will display in columns but won't filter or
 * group on the server.
 *
 * If the field has no usable extractors (empty chain, or every
 * extractor is `regex`) the result is the literal `NULL` — callers
 * still get a valid SQL expression, the predicate just never
 * matches, mirroring the read-path resolver returning null.
 */
export interface LogicalFieldSql {
  readonly sql: string;
  readonly needsSourceJoin: boolean;
}

/**
 * Each `$.x.y` path segment must look like a JS identifier — anything
 * else is silently dropped to keep the JSON-path string non-injectable.
 * (We don't have a placeholder for `$.<key>` in SQLite, so the SQL
 * builder interpolates verbatim.)
 */
const PATH_SEGMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const isValidJsonPath = (path: string): boolean => {
  if (path.length === 0) return false;
  for (const seg of path.split('.')) {
    if (!PATH_SEGMENT_RE.test(seg)) return false;
  }
  return true;
};

/** SQLite string-literal escape: double every single quote. */
const sqlEscape = (s: string): string => s.replace(/'/g, "''");

/**
 * Render one extractor as a SQL value expression, or `null` when the
 * extractor cannot run in SQL (the `regex` type, or an invalid path).
 * Exposed so the indexer's coverage report and the COALESCE builder
 * share the same compilation logic.
 */
export const extractorToSqlOrNull = (ex: LogicalExtractor): string | null => {
  if (ex.type === 'field') {
    if (!isValidJsonPath(ex.path)) return null;
    return `JSON_EXTRACT(entry.fields_json, '$.${ex.path}')`;
  }
  if (ex.type === 'regex-on-json') {
    if (!isValidJsonPath(ex.path)) return null;
    const pattern = sqlEscape(ex.pattern);
    const group = sqlEscape(ex.group ?? '');
    const flags = sqlEscape(ex.flags ?? '');
    return (
      `regexp_extract_group('${pattern}', ` +
      `JSON_EXTRACT(entry.fields_json, '$.${ex.path}'), ` +
      `'${group}', '${flags}')`
    );
  }
  // 'regex' on message/raw — body lives outside SQLite (ADR-0016).
  return null;
};

/**
 * A logical field is "body-only" when none of its extractors compile to
 * SQL — i.e. every extractor is a `regex` over `message`/`raw`, which
 * after ADR-0016 are not materialised in SQLite. Such a field compiles
 * to SQL `NULL` and can only be resolved on the read path (in memory,
 * over already-read bodies). The column renderer already does this; the
 * coordinator uses this predicate to route group-by / filter / sort
 * through the read-path scanner instead of SQL.
 */
export const isBodyOnlyLogicalField = (field: LogicalField): boolean =>
  field.extractors.every((ex) => extractorToSqlOrNull(ex) === null);

export const logicalFieldToSql = (field: LogicalField): LogicalFieldSql => {
  const exprs: string[] = [];
  for (const ex of field.extractors) {
    const sql = extractorToSqlOrNull(ex);
    if (sql !== null) exprs.push(sql);
  }
  if (exprs.length === 0) return { sql: 'NULL', needsSourceJoin: false };
  if (exprs.length === 1) return { sql: exprs[0]!, needsSourceJoin: false };
  return {
    sql: `COALESCE(${exprs.join(', ')})`,
    needsSourceJoin: false,
  };
};
