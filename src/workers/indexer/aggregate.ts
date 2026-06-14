import type { SqlValue } from '@sqlite.org/sqlite-wasm';
import type {
  FieldKey,
  LogLevel,
  LogicalFieldsCtx,
} from '../../core/types/index.ts';
import {
  fieldKeyToSql,
  type FieldKeySql,
} from '../../core/filter/field-key.ts';

export const ALL_LEVELS: ReadonlyArray<LogLevel> = [
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
  'unknown',
];

/**
 * Map legacy bare names that pre-date ADR-0017 onto the unified
 * `@`-namespace, so that callers passing `'level'`/`'source_id'`/
 * `'service'` continue to work while the picker UIs migrate to
 * emitting `FieldKey` directly.
 */
const LEGACY_BARE_KEY: Readonly<Record<string, FieldKey>> = {
  level: '@level',
  source_id: '@source.id',
};

/**
 * Resolve the user-provided group field to a SQL expression and a
 * `needsSourceJoin` flag (the caller adds `JOIN source ...` to the
 * FROM clause when the flag is set).
 *
 * Accepts:
 *  - `@`-prefixed built-ins (`@ts`, `@level`, `@source.name`, …)
 *  - dynamic JSON keys (`trace_id`, `service`)
 *  - legacy bare names (`level`, `source_id`) for backward compat
 *
 * Throws on anything else (including unknown `@`-keys), so a
 * mistyped key fails loud at query time instead of silently
 * matching nothing.
 */
export const groupFieldExpr = (
  field: string,
  ctx: LogicalFieldsCtx = {},
): FieldKeySql => {
  const key = LEGACY_BARE_KEY[field] ?? field;
  return fieldKeyToSql(key, ctx);
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
