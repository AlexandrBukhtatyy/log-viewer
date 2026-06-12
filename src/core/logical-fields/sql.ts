import type { LogicalField } from '../types/logical-field.ts';

/**
 * Translate a `LogicalField` into a SQL value expression equivalent to
 * the read-path resolver: try each extractor in order, the first
 * non-null wins (COALESCE).
 *
 * Only `field`-type extractors compile to SQL — they become
 * `JSON_EXTRACT(entry.fields_json, '$.<path>')`. `regex`-type
 * extractors target `entry.message` / `entry.raw`, which are NOT
 * materialised in SQLite after ADR-0016 (the body lives behind a
 * lazy byte-pointer). They are silently skipped here and only run
 * on the read-path resolver — so a `~`-field defined purely as
 * regex(message=…) will display in columns but won't filter or
 * group on the server. The `regexp_extract_group` UDF in `open-db`
 * is wired for a future `regex-on-json` extractor that targets
 * values already living in `fields_json`.
 *
 * If the field has no usable extractors (empty chain, or every
 * extractor is regex) the result is the literal `NULL` — callers
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

const isValidJsonPath = (path: string): boolean => {
  if (path.length === 0) return false;
  for (const seg of path.split('.')) {
    if (!PATH_SEGMENT_RE.test(seg)) return false;
  }
  return true;
};

export const logicalFieldToSql = (field: LogicalField): LogicalFieldSql => {
  const exprs: string[] = [];
  for (const ex of field.extractors) {
    if (ex.type !== 'field') continue;
    if (!isValidJsonPath(ex.path)) continue;
    exprs.push(`JSON_EXTRACT(entry.fields_json, '$.${ex.path}')`);
  }
  if (exprs.length === 0) return { sql: 'NULL', needsSourceJoin: false };
  if (exprs.length === 1) return { sql: exprs[0]!, needsSourceJoin: false };
  return {
    sql: `COALESCE(${exprs.join(', ')})`,
    needsSourceJoin: false,
  };
};
