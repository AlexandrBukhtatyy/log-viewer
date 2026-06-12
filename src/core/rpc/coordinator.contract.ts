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

/**
 * Focus hint pushed from the UI to the coordinator. Tells the parser-pool
 * which batches deserve priority and tells directory adapters which files
 * to pull to the front of their read plan. Idempotent — call as often as
 * the user clicks around.
 */
export interface FocusInput {
  /** Sources the user is actively looking at (active tab + multi-select). */
  readonly sources: ReadonlyArray<SourceId>;
  /**
   * Specific relative file paths within directory sources. Empty means
   * "every file in the focused sources is hot"; non-empty narrows the
   * hot-set to just these files.
   */
  readonly filePaths: ReadonlyArray<string>;
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
   * Push the active logical-field definitions (ADR-0030, `~`-namespace)
   * down to the indexer. Called by the main thread whenever the user
   * activates / deactivates / edits a logical field. The indexer keeps
   * the latest snapshot until the next push; an empty array disables
   * the feature (`~`-keys compile to SQL NULL).
   */
  setLogicalFields: (
    fields: ReadonlyArray<import('../types/index.ts').LogicalField>,
  ) => Promise<void>;

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

  /**
   * Push the user's current focus (active tab + multi-selected files) so the
   * coordinator can prioritise parser-pool batches and reorder directory
   * adapters' read plans. Idempotent; safe to call on every UI selection
   * change.
   */
  setFocus: (input: FocusInput) => Promise<void>;

  /**
   * Terminate the child indexer worker so its OPFS SAH-pool lock is
   * released *before* this coordinator itself is terminated. Used by the
   * main-thread HMR/destroy path — without this the indexer is orphaned
   * across HMR cycles and the next page-load fights for the SAH lock for
   * tens of seconds.
   *
   * After this resolves, any subsequent RPC that touches the indexer
   * (e.g. `addSource`) will re-spawn it from scratch.
   */
  shutdownIndexer: () => Promise<void>;
}

export interface RpcError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
  readonly cause?: unknown;
}

export type SourceStatusUpdate = SourceRecord & { readonly at: number };
export type { SourceStatus };
