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
