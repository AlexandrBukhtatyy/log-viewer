import type {
  EntryId,
  LogEntry,
  LogFilter,
  LogSourceInput,
  SourceId,
  SourceRecord,
  SourceStatus,
} from '../types/index.ts';

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
