import type { SqlValue } from '@sqlite.org/sqlite-wasm';
import type { LogLevel } from '../../core/types/index.ts';

export const ALL_LEVELS: ReadonlyArray<LogLevel> = [
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
  'unknown',
];

const FIELD_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Resolve the user-provided group field to a SQL expression.
 *
 * - `level` / `source_id` → entry.<col> (no JSON parse, indexed).
 * - any other identifier → `JSON_EXTRACT(entry.fields_json, '$.<key>')`.
 *
 * `field` must match `^[A-Za-z_][A-Za-z0-9_]*$` — string interpolation is
 * safe only inside that whitelist; anything else throws to abort the query.
 */
export const groupFieldExpr = (field: string): string => {
  if (!FIELD_NAME_RE.test(field)) {
    throw new Error(`invalid group field: ${field}`);
  }
  if (field === 'level' || field === 'source_id') {
    return `entry.${field}`;
  }
  return `JSON_EXTRACT(entry.fields_json, '$.${field}')`;
};

/**
 * Compose `SUM(CASE WHEN level=? THEN 1 ELSE 0 END) AS lc_<level>` for each
 * known level, plus the bind values. Used by groupCounts and histogram to
 * break aggregates down by level in a single pass.
 */
export const levelBreakdownSql = (): {
  columns: string;
  binds: ReadonlyArray<SqlValue>;
} => {
  const cols: string[] = [];
  const binds: SqlValue[] = [];
  for (const lvl of ALL_LEVELS) {
    cols.push(`SUM(CASE WHEN level = ? THEN 1 ELSE 0 END) AS lc_${lvl}`);
    binds.push(lvl);
  }
  return { columns: cols.join(', '), binds };
};

export const collectLevelCounts = (
  row: Record<string, SqlValue>,
): Readonly<Record<string, number>> => {
  const out: Record<string, number> = {};
  for (const lvl of ALL_LEVELS) {
    const n = Number(row[`lc_${lvl}`] ?? 0);
    if (n > 0) out[lvl] = n;
  }
  return out;
};
