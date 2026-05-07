import type { LogEntry, SourceRecord } from '../types/index.ts';
import type { FieldKey } from '../types/log-filter.ts';

/**
 * Translation of a `FieldKey` (ADR-0017 `@`-namespace) into an SQL fragment.
 *
 * `sql` is a *value expression* that can be used wherever a column reference
 * is allowed: SELECT, WHERE, GROUP BY, ORDER BY. Caller is responsible for
 * appending `joinSql` to the FROM clause when `needsSourceJoin` is true.
 *
 * Built-in keys interpolate fixed identifiers (whitelisted, no injection
 * risk). Dynamic keys interpolate the user-supplied name into a JSON path
 * after a strict `[A-Za-z_][A-Za-z0-9_]*` check, since SQLite has no
 * placeholder for the path argument that survives `GROUP BY`.
 */
export interface FieldKeySql {
  readonly sql: string;
  readonly needsSourceJoin: boolean;
}

const BUILT_IN: Readonly<Record<string, FieldKeySql>> = {
  '@ts':         { sql: 'entry.ts',         needsSourceJoin: false },
  '@level':      { sql: 'entry.level',      needsSourceJoin: false },
  '@seq':        { sql: 'entry.seq',        needsSourceJoin: false },
  '@file':       { sql: 'entry.file_path',  needsSourceJoin: false },
  '@byte_start': { sql: 'entry.byte_start', needsSourceJoin: false },
  '@byte_end':   { sql: 'entry.byte_end',   needsSourceJoin: false },
  '@source.id':  { sql: 'entry.source_id',  needsSourceJoin: false },
  '@source.name':{ sql: 'source.name',      needsSourceJoin: true  },
  '@source.kind':{ sql: 'source.kind',      needsSourceJoin: true  },
};

/** Built-in `@`-keys exposed by the translator. */
export const BUILT_IN_FIELD_KEYS: ReadonlyArray<FieldKey> = Object.keys(BUILT_IN);

const DYNAMIC_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const isBuiltInFieldKey = (key: FieldKey): boolean => key in BUILT_IN;

export const fieldKeyToSql = (key: FieldKey): FieldKeySql => {
  const builtIn = BUILT_IN[key];
  if (builtIn !== undefined) return builtIn;
  if (key.startsWith('@')) {
    throw new Error(`unknown built-in field key: ${key}`);
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
 * `null` in that case).
 */
export const getEntryFieldValue = (
  entry: LogEntry,
  key: FieldKey,
  sourceRecord?: SourceRecord | null,
): unknown => {
  switch (key) {
    case '@ts':         return entry.timestamp;
    case '@level':      return entry.level;
    case '@seq':        return entry.seq;
    case '@file':       return entry.filePath;
    case '@byte_start': return entry.byteStart;
    case '@byte_end':   return entry.byteEnd;
    case '@source.id':  return entry.sourceId;
    case '@source.name': return sourceRecord?.source.name ?? null;
    case '@source.kind': return sourceRecord?.source.kind ?? null;
    default:
      if (key.startsWith('@')) return null;
      return (entry.fields as Record<string, unknown>)[key];
  }
};

