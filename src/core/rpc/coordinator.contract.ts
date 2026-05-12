import type {
  EntryId,
  LogEntry,
  LogFilter,
  LogSourceInput,
  SourceId,
  SourceRecord,
  SourceStatus,
} from '../types/index.ts';
import type { FieldDescriptor } from '../filter/field-descriptor.ts';

export interface RangeCounts {
  readonly total: number;
  readonly filtered: number;
}

export interface ChangesNotice {
  readonly version: number;
  readonly filteredCount: number;
}

export interface ResumeReport {
  readonly resumed: ReadonlyArray<SourceId>;
  readonly needsPermission: ReadonlyArray<SourceId>;
}

export type ExportFormat = 'jsonl' | 'csv';

/**
 * Public metadata about a registered parser, exposed via
 * `coordinator.listParsers()` for the UI (Phase 2.B). Doesn't carry
 * the regex/`parseLine` itself — just enough to populate a picker
 * (id, default-columns hint).
 */
export interface ParserInfo {
  readonly id: string;
  readonly defaultColumns: ReadonlyArray<string>;
}

export interface CallOptions {
  readonly taskId?: string;
}

/**
 * Aggregated counts for a single group bucket (one distinct value of the
 * grouping field). `path` carries the parent-group context so nested expand
 * can be resolved server-side without the UI re-deriving it from filters.
 */
export interface GroupBucket {
  /** The grouping value for this bucket (string-coerced). `null` = entries where the field is missing. */
  readonly value: string | null;
  readonly count: number;
  readonly tsMin: number | null;
  readonly tsMax: number | null;
  /** Per-level counts; absent levels are omitted. */
  readonly levelCounts: Readonly<Record<string, number>>;
}

export interface HistogramBucket {
  /** Bucket lower bound (epoch ms); `tsTo - tsFrom` is constant within a single histogram response. */
  readonly tsFrom: number;
  readonly tsTo: number;
  readonly count: number;
  readonly levelCounts: Readonly<Record<string, number>>;
}

export interface HistogramResponse {
  readonly buckets: ReadonlyArray<HistogramBucket>;
  /** Total `ts` range covered by buckets. `null` if no entries match the filter. */
  readonly range: { readonly from: number; readonly to: number } | null;
}

export interface CoordinatorApi {
  ping: () => Promise<string>;

  addSource: (source: LogSourceInput, options?: CallOptions) => Promise<SourceId>;
  removeSource: (id: SourceId) => Promise<void>;
  reIndex: (id: SourceId, options?: CallOptions) => Promise<void>;

  setFilter: (filter: LogFilter) => Promise<void>;
  getFilter: () => Promise<LogFilter>;

  getRange: (from: number, to: number) => Promise<ReadonlyArray<LogEntry>>;
  getCount: () => Promise<RangeCounts>;
  getEntry: (id: EntryId) => Promise<LogEntry | null>;

  /**
   * Like `getRange` but takes the filter explicitly instead of using
   * the active one. Used by inline group expansion (a bucket pulls the
   * entries that match its `(field=value)` scope without having to
   * change the global filter).
   */
  getEntriesScoped: (
    filter: LogFilter,
    from: number,
    to: number,
  ) => Promise<ReadonlyArray<LogEntry>>;

  /**
   * Server-side group-by aggregation. `field` is a JSON path inside
   * `fields_json` ("$.<key>") OR one of the entry-level columns: `level`,
   * `source_id`, `service`. Results are sorted by `count DESC, value ASC`.
   * `limit` clamps the bucket count (default 1000).
   */
  getGroupCounts: (
    filter: LogFilter,
    field: string,
    limit?: number,
  ) => Promise<ReadonlyArray<GroupBucket>>;

  /**
   * Server-side histogram over `ts`. `bucketCount` controls resolution; range
   * is derived from min/max ts of matching entries (or filter.timeRange when
   * both bounds set). Empty buckets are still returned (count=0) for stable
   * x-axis rendering. `null`-ts entries are excluded.
   */
  getHistogram: (
    filter: LogFilter,
    bucketCount: number,
  ) => Promise<HistogramResponse>;

  /**
   * Discover which fields are available for the given filter (ADR-0017).
   * Returns built-in `@`-attributes (constant) + dynamic JSON keys
   * aggregated from `field_meta` for the source set named in
   * `filter.sources` (or all known sources when that is null).
   *
   * Used by the column / group-by / filter pickers to enumerate keys
   * and surface usage stats (occurrences, presenceRate, top values).
   */
  getFieldSchema: (filter: LogFilter) => Promise<ReadonlyArray<FieldDescriptor>>;

  /**
   * Enumerate parsers registered in the worker-side `ParserRegistry`.
   * UI uses this to populate the parser-override dropdown when adding
   * a source (Phase 2.B). Returned in priority-descending order so
   * the auto-detect winner sits at the top of the menu.
   */
  listParsers: () => Promise<ReadonlyArray<ParserInfo>>;

  /** List user-defined custom parser definitions (Phase 2.C). */
  listCustomParsers: () => Promise<
    ReadonlyArray<import('../parsers/custom-parser-def.ts').CustomParserDef>
  >;
  /** Save (insert/update) a custom parser definition; re-registers in workers. */
  upsertCustomParser: (
    def: import('../parsers/custom-parser-def.ts').CustomParserDef,
  ) => Promise<void>;
  /** Delete a custom parser by id; sources using it fall back to auto-detect on next ingest. */
  removeCustomParser: (id: string) => Promise<void>;

  /**
   * Change the parser used by a single source (Phase 2.C.6). `parserId` is
   * either a registered parser id, or `null` to clear the override (revert
   * to auto-detect). Wipes existing entries for the source and re-ingests
   * from scratch so the rows reflect the new parser. No-op if the source
   * isn't currently live.
   */
  setSourceParser: (id: SourceId, parserId: string | null) => Promise<void>;

  listSources: () => Promise<ReadonlyArray<SourceRecord>>;
  subscribeStatus: (
    cb: (records: ReadonlyArray<SourceRecord>) => void,
  ) => Promise<() => void>;
  subscribeChanges: (
    cb: (notice: ChangesNotice) => void,
  ) => Promise<() => void>;

  resumePersistedSources: () => Promise<ResumeReport>;
  grantPermission: (id: SourceId) => Promise<boolean>;

  estimateStorage: () => Promise<{
    used: number;
    quota: number;
    perSource: ReadonlyArray<{ id: SourceId; bytes: number }>;
  }>;
  clearAll: () => Promise<void>;
  clearSource: (id: SourceId) => Promise<void>;

  exportFiltered: (
    filter: LogFilter,
    format: ExportFormat,
    options?: CallOptions,
  ) => Promise<Blob>;

  cancel: (taskId: string) => Promise<void>;
}

export interface RpcError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
  readonly cause?: unknown;
}

export type SourceStatusUpdate = SourceRecord & { readonly at: number };
export type { SourceStatus };
