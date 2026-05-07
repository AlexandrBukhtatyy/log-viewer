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
   * `directory`/`snapshot`). Matches against `fields.file_path` set by the
   * ingest pipeline. The sidebar populates this when the user picks
   * individual files inside a directory tree. `null` — no constraint.
   */
  readonly filePaths: ReadonlyArray<string> | null;
  readonly fieldFilters?: ReadonlyArray<FieldFilter>;
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
};
