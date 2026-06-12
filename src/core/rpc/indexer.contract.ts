import type {
  EntryId,
  LogEntry,
  LogFilter,
  LogSource,
  LogSourceKind,
  LogicalField,
  SourceId,
} from '../types/index.ts';
import type { FieldDescriptor } from '../filter/field-descriptor.ts';
import type { GroupBucket, HistogramResponse } from './coordinator.contract.ts';

/**
 * Indexer не хранит File/FileSystemHandle (они живут в coordinator handle-store).
 * Поэтому listSources отдаёт сериализуемую часть. Coordinator при необходимости
 * соединяет её со своим handle-store, чтобы собрать LogSource целиком.
 */
export interface IndexedSourceRecord {
  readonly id: SourceId;
  readonly kind: LogSourceKind;
  readonly name: string;
  readonly metaJson: string | null;
  readonly indexedAt: number | null;
  readonly entryCount: number;
}

export interface OpenReport {
  readonly migrationFrom: number;
  readonly migrationTo: number;
  readonly target: number;
}

export interface SizeReport {
  readonly total: number;
  readonly perSource: ReadonlyArray<{ id: SourceId; bytes: number }>;
}

export interface IndexerApi {
  ping: () => Promise<string>;
  open: () => Promise<OpenReport>;
  close: () => Promise<void>;

  upsertSource: (source: LogSource) => Promise<void>;
  removeSource: (id: SourceId) => Promise<void>;
  listSources: () => Promise<ReadonlyArray<IndexedSourceRecord>>;

  insertBatch: (entries: ReadonlyArray<LogEntry>) => Promise<void>;
  search: (
    filter: LogFilter,
    from: number,
    to: number,
  ) => Promise<ReadonlyArray<LogEntry>>;
  count: (filter: LogFilter) => Promise<number>;
  getEntry: (id: EntryId) => Promise<LogEntry | null>;

  groupCounts: (
    filter: LogFilter,
    field: string,
    limit?: number,
  ) => Promise<ReadonlyArray<GroupBucket>>;

  /**
   * Per-source field schema cache (ADR-0017). Returns one descriptor per
   * dynamic key seen across `sourceIds`, with occurrences/total_seen
   * summed and top-K values merged. Built-in `@`-attributes are NOT
   * included — the coordinator appends them from `BUILT_IN_FIELD_DESCRIPTORS`.
   *
   * Empty `sourceIds` → empty array (caller still sees built-ins).
   */
  fieldMeta: (
    sourceIds: ReadonlyArray<SourceId>,
  ) => Promise<ReadonlyArray<FieldDescriptor>>;
  histogram: (
    filter: LogFilter,
    bucketCount: number,
  ) => Promise<HistogramResponse>;

  /**
   * Materialize the entire filtered dataset into a single string. Caller is
   * responsible for wrapping it in a Blob with the right MIME type — keeping
   * this contract serializable also makes it cheap to test without a live
   * worker.
   */
  exportFiltered: (
    filter: LogFilter,
    format: 'jsonl' | 'csv',
  ) => Promise<string>;

  /**
   * Push the currently activated logical fields (ADR-0030) into the
   * indexer so subsequent `search`/`count`/`groupCounts`/`histogram`/
   * `exportFiltered` calls can compile `~name` field-keys into the
   * matching `COALESCE(JSON_EXTRACT(…), …)` chain. The main thread
   * calls this on every `LogicalFieldsConfig` change; the indexer
   * keeps the latest snapshot until the next push.
   */
  setLogicalFields: (
    fields: ReadonlyArray<LogicalField>,
  ) => Promise<void>;

  vacuum: () => Promise<void>;
  estimateSize: () => Promise<SizeReport>;
  clearAll: () => Promise<void>;
}
