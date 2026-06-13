import type { LogEntry, LogLevel, SourceId } from './log-entry.ts';

/**
 * A field reference in the unified `@`-namespace (ADR-0017).
 *
 * - Built-in attributes use `@`-prefix: `@ts`, `@level`, `@seq`, `@file`,
 *   `@byte_start`, `@byte_end`, `@source.id`, `@source.name`, `@source.kind`.
 * - Anything else is treated as a key inside `entry.fields_json` (e.g.
 *   `trace_id`, `service`, `status`).
 *
 * The actual SQL translation lives in `core/filter/field-key.ts`. Plain
 * `string` keeps the type ergonomic at API boundaries (RPC payloads,
 * UI prefs) — the validator/translator rejects malformed values.
 */
export type FieldKey = string;

export type QueryMode = 'substring' | 'fts' | 'regex';

/**
 * Field-filter operators (UI-natural symbol form):
 *  '='  — equality (string compare)
 *  '!=' — inequality
 *  '~'  — substring (case-insensitive)
 *  '>'  — numeric greater-than (CAST AS REAL)
 *  '<'  — numeric less-than
 */
export type FieldFilterOp = '=' | '!=' | '~' | '>' | '<';

export interface FieldFilter {
  readonly key: string;
  readonly op: FieldFilterOp;
  readonly value: string;
}

export interface TimeRange {
  readonly from: number | null;
  readonly to: number | null;
}

/**
 * Single-column sort imposed by the user clicking a table header.
 * When present on `LogFilter`, the SQL builder's ORDER BY uses this
 * instead of the `orderBy` shape hint. `key` is a `FieldKey` —
 * built-in `@`-attribute, dynamic JSON key, or `~`-logical (ADR-0030).
 */
export interface LogFilterSort {
  readonly key: FieldKey;
  readonly dir: 'asc' | 'desc';
}

export interface LogFilter {
  readonly levels: ReadonlyArray<LogLevel> | null;
  readonly query: string;
  readonly queryMode: QueryMode;
  readonly caseSensitive: boolean;
  /**
   * When true, substring/regex queries match only at word boundaries
   * (\b...\b). For FTS the query is wrapped in phrase quotes.
   */
  readonly wholeWord: boolean;
  readonly timeRange: TimeRange | null;
  readonly sources: ReadonlyArray<SourceId> | null;
  /**
   * Service filter (parallel to `sources`). Matches any of the listed
   * service names against `fields.service` extracted from JSON.
   * `null` — no constraint, `[]` — match nothing.
   */
  readonly services: ReadonlyArray<string> | null;
  /**
   * Per-file filter for sources with inner file structure (currently
   * `directory`/`snapshot`). Matches against the `entry.file_path`
   * column via the `@file` field-key. The sidebar populates this when
   * the user picks individual files inside a directory tree. `null` —
   * no constraint.
   */
  readonly filePaths: ReadonlyArray<string> | null;
  readonly fieldFilters?: ReadonlyArray<FieldFilter>;
  /**
   * Row ordering. Optional override; when unset (the typical case),
   * `orderByForFilter` infers from filter shape: single-source-single-file
   * → `'physical'` (`source_id ASC, seq ASC`, keeps gutter line numbers
   * monotonic), multi-file or multi-source → `'time'` (interleave by
   * `ts ASC`). Set explicitly to force one or the other regardless of
   * shape — used by saved searches and future UI toggles.
   */
  readonly orderBy?: 'time' | 'physical';
  /**
   * User-imposed column sort. When set, wins over `orderBy` and the
   * auto-infer in `orderByForFilter`. `undefined` means "no explicit
   * sort — fall back to the existing time/physical pipeline".
   */
  readonly sortBy?: LogFilterSort;
}

export type FilterPredicate = (entry: LogEntry) => boolean;

export const EMPTY_FILTER: LogFilter = {
  levels: null,
  query: '',
  queryMode: 'substring',
  caseSensitive: false,
  wholeWord: false,
  timeRange: null,
  sources: null,
  services: null,
  filePaths: null,
  // No explicit orderBy — let `orderByForFilter` pick based on filter
  // shape (physical for single-source single-file, time for multi).
};

const sameArr = <T>(
  a: ReadonlyArray<T> | null | undefined,
  b: ReadonlyArray<T> | null | undefined,
  eq: (x: T, y: T) => boolean = Object.is,
): boolean => {
  if (a === b) return true;
  if (a == null || b == null) return (a ?? null) === (b ?? null);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!eq(a[i]!, b[i]!)) return false;
  return true;
};

/**
 * Structural equality for `LogFilter`. Used by `ViewStore.setFilter` to
 * short-circuit no-op updates: the container recomputes the filter
 * object on every render that touches `selectedIds`, `activeTabId` or
 * `coreFilter`, even when the resulting contents are identical (e.g.
 * toggling a sidebar checkbox while a file-tab is active doesn't change
 * the file-tab's `sources`). Skipping the worker round-trip and the
 * entry-cache wipe keeps the open tab from flickering.
 */
export const filtersEqual = (a: LogFilter, b: LogFilter): boolean => {
  if (a === b) return true;
  if (
    a.query !== b.query ||
    a.queryMode !== b.queryMode ||
    a.caseSensitive !== b.caseSensitive ||
    a.wholeWord !== b.wholeWord ||
    a.orderBy !== b.orderBy
  ) {
    return false;
  }
  const as = a.sortBy;
  const bs = b.sortBy;
  if (as !== bs) {
    if (as === undefined || bs === undefined) return false;
    if (as.key !== bs.key || as.dir !== bs.dir) return false;
  }
  if (!sameArr(a.levels, b.levels)) return false;
  if (!sameArr(a.sources, b.sources)) return false;
  if (!sameArr(a.services, b.services)) return false;
  if (!sameArr(a.filePaths, b.filePaths)) return false;
  const at = a.timeRange;
  const bt = b.timeRange;
  if (at !== bt) {
    if (at == null || bt == null) return false;
    if (at.from !== bt.from || at.to !== bt.to) return false;
  }
  if (
    !sameArr(
      a.fieldFilters,
      b.fieldFilters,
      (x, y) => x.key === y.key && x.op === y.op && x.value === y.value,
    )
  ) {
    return false;
  }
  return true;
};
