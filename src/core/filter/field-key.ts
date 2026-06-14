import { logicalFieldToSql } from '../logical-fields/sql.ts';
import { resolveLogicalField } from '../logical-fields/resolver.ts';
import type {
  LogEntry,
  LogicalFieldsCtx,
  SourceRecord,
} from '../types/index.ts';
import type { FieldKey } from '../types/log-filter.ts';
import {
  LOGICAL_FIELD_PREFIX,
  logicalFieldIdOf,
} from '../types/logical-field.ts';

/**
 * Translation of a `FieldKey` (ADR-0017 `@`-namespace, ADR-0030
 * `~`-namespace) into an SQL fragment.
 *
 * `sql` is a *value expression* that can be used wherever a column reference
 * is allowed: SELECT, WHERE, GROUP BY, ORDER BY. Caller is responsible for
 * appending `joinSql` to the FROM clause when `needsSourceJoin` is true.
 *
 * Built-in keys interpolate fixed identifiers (whitelisted, no injection
 * risk). Dynamic keys interpolate the user-supplied name into a JSON path
 * after a strict `[A-Za-z_][A-Za-z0-9_]*` check, since SQLite has no
 * placeholder for the path argument that survives `GROUP BY`. Logical
 * (`~`) keys expand to a `COALESCE(JSON_EXTRACT(...), …)` chain built
 * from the matching `LogicalField` definition in `ctx`.
 */
export interface FieldKeySql {
  readonly sql: string;
  readonly needsSourceJoin: boolean;
}

const BUILT_IN: Readonly<Record<string, FieldKeySql>> = {
  '@ts': { sql: 'entry.ts', needsSourceJoin: false },
  '@level': { sql: 'entry.level', needsSourceJoin: false },
  '@seq': { sql: 'entry.seq', needsSourceJoin: false },
  '@file': { sql: 'entry.file_path', needsSourceJoin: false },
  '@byte_start': { sql: 'entry.byte_start', needsSourceJoin: false },
  '@byte_end': { sql: 'entry.byte_end', needsSourceJoin: false },
  '@source.id': { sql: 'entry.source_id', needsSourceJoin: false },
  '@source.name': { sql: 'source.name', needsSourceJoin: true },
  '@source.kind': { sql: 'source.kind', needsSourceJoin: true },
};

/** Built-in `@`-keys exposed by the translator. */
export const BUILT_IN_FIELD_KEYS: ReadonlyArray<FieldKey> =
  Object.keys(BUILT_IN);

// Dynamic JSON field keys. `[A-Za-z_][A-Za-z0-9_]*` is the standard
// identifier shape that interpolates into `$.<key>` JSONPath safely.
// `\$\d+` is the positional-token shape produced by `plain-text-parser`
// — it lives in `fields_json` like any other dynamic key but cannot be
// reached via dot-notation, so the SQL emitter switches to the bracket
// form for those.
const DYNAMIC_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const POSITIONAL_KEY_RE = /^\$\d+$/;

export const isBuiltInFieldKey = (key: FieldKey): boolean => key in BUILT_IN;

const UNKNOWN_LOGICAL: FieldKeySql = { sql: 'NULL', needsSourceJoin: false };

export const fieldKeyToSql = (
  key: FieldKey,
  ctx: LogicalFieldsCtx = {},
): FieldKeySql => {
  if (key.startsWith(LOGICAL_FIELD_PREFIX)) {
    const id = logicalFieldIdOf(key);
    if (id === null) return UNKNOWN_LOGICAL;
    const field = ctx.activeLogicalFields?.find((f) => f.id === id);
    if (field === undefined) return UNKNOWN_LOGICAL;
    return logicalFieldToSql(field);
  }
  const builtIn = BUILT_IN[key];
  if (builtIn !== undefined) return builtIn;
  if (key.startsWith('@')) {
    throw new Error(`unknown built-in field key: ${key}`);
  }
  if (POSITIONAL_KEY_RE.test(key)) {
    // SQLite JSONPath accepts member access via bracket-and-quote.
    return {
      sql: `JSON_EXTRACT(entry.fields_json, '$["${key}"]')`,
      needsSourceJoin: false,
    };
  }
  if (!DYNAMIC_KEY_RE.test(key)) {
    throw new Error(`invalid dynamic field key: ${key}`);
  }
  return {
    sql: `JSON_EXTRACT(entry.fields_json, '$.${key}')`,
    needsSourceJoin: false,
  };
};

export const SOURCE_JOIN_SQL = 'JOIN source ON source.id = entry.source_id';

/**
 * In-memory mirror of `fieldKeyToSql` — returns the value a SQL query
 * for the same key would produce, but reading off an already-resolved
 * `LogEntry` (and its source). Used by the column picker to render
 * dynamic cells without an extra round-trip.
 *
 * `@source.name` / `@source.kind` need a `SourceRecord` lookup; pass
 * `undefined` when the caller does not have it (the cell renders as
 * `null` in that case). `~`-keys consult `ctx.activeLogicalFields` to
 * find their extractor chain — unknown ids resolve to `null`.
 */
export const getEntryFieldValue = (
  entry: LogEntry,
  key: FieldKey,
  sourceRecord?: SourceRecord | null,
  ctx: LogicalFieldsCtx = {},
): unknown => {
  if (key.startsWith(LOGICAL_FIELD_PREFIX)) {
    const id = logicalFieldIdOf(key);
    if (id === null) return null;
    const field = ctx.activeLogicalFields?.find((f) => f.id === id);
    if (field === undefined) return null;
    return resolveLogicalField(entry, field);
  }
  switch (key) {
    case '@ts':
      return entry.timestamp;
    case '@level':
      return entry.level;
    case '@seq':
      return entry.seq;
    case '@file':
      return entry.filePath;
    case '@byte_start':
      return entry.byteStart;
    case '@byte_end':
      return entry.byteEnd;
    case '@source.id':
      return entry.sourceId;
    case '@source.name':
      return sourceRecord?.source.name ?? null;
    case '@source.kind':
      return sourceRecord?.source.kind ?? null;
    default:
      if (key.startsWith('@')) return null;
      return (entry.fields as Record<string, unknown>)[key];
  }
};
