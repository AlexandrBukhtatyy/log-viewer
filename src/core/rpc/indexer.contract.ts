import type {
  EntryId,
  LogEntry,
  LogFilter,
  LogSource,
  LogSourceKind,
  SourceId,
} from '../types/index.ts';

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

  vacuum: () => Promise<void>;
  estimateSize: () => Promise<SizeReport>;
  clearAll: () => Promise<void>;
}
