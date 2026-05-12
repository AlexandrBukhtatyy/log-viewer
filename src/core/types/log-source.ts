import type { SourceId } from './log-entry.ts';

/**
 * Per-source parser override (Phase 2.B). When set, ingest-orchestrator
 * bypasses auto-detect and uses `registry.pickById(parserId)`. `undefined`
 * keeps the legacy behaviour (auto-detect on the first non-empty line).
 */
export interface ParserOverride {
  readonly parserId?: string;
}

export type FileLogSource = ParserOverride & {
  readonly kind: 'file';
  readonly id: SourceId;
  readonly name: string;
  readonly size: number;
  readonly file: File;
};

export type DirectoryLogSource = ParserOverride & {
  readonly kind: 'directory';
  readonly id: SourceId;
  readonly name: string;
  readonly handle: FileSystemDirectoryHandle;
  readonly glob?: string;
  /**
   * UI hint: this directory was added as a "watched folder" — the user
   * expects new files / appended bytes to surface live. The current
   * adapter does not yet implement watching (planned Phase-4 follow-up);
   * the flag is persisted in metadata so the sidebar tree can put the
   * source under "Watched folders" vs "Local files".
   */
  readonly watch?: boolean;
};

export type TextLogSource = ParserOverride & {
  readonly kind: 'text';
  readonly id: SourceId;
  readonly name: string;
  readonly text: string;
};

export type UrlLogSource = ParserOverride & {
  readonly kind: 'url';
  readonly id: SourceId;
  readonly name: string;
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
};

export type StreamLogSource = ParserOverride & {
  readonly kind: 'stream';
  readonly id: SourceId;
  readonly name: string;
  readonly transport: 'ws' | 'sse';
  readonly url: string;
};

/**
 * The variants below cover UI-exposed source kinds whose adapters are not yet
 * implemented (CORS / proxy / native API constraints — see
 * docs/plans/replicated-cooking-muffin.md §1.5). The shape and registration
 * are here so the type system, hooks, ViewStore and coordinator stay aligned
 * with the UI menu; the adapters themselves throw `not implemented` on open
 * until each integration ADR lands.
 */
export type RemoteSshLogSource = {
  readonly kind: 'remote-ssh';
  readonly id: SourceId;
  readonly name: string;
  readonly host: string;
  readonly user?: string;
  readonly paths?: ReadonlyArray<string>;
  readonly keyPath?: string;
};

export type CloudProvider = 'datadog' | 'cloudwatch' | 'gcp' | 'other';

export type CloudLogSource = {
  readonly kind: 'cloud';
  readonly id: SourceId;
  readonly name: string;
  readonly provider: CloudProvider;
  readonly query?: string;
  readonly region?: string;
};

export type K8sLogSource = {
  readonly kind: 'k8s';
  readonly id: SourceId;
  readonly name: string;
  readonly cluster: string;
  readonly namespace?: string;
  readonly pod?: string;
  readonly container?: string;
};

export type BusLogSource = {
  readonly kind: 'bus';
  readonly id: SourceId;
  readonly name: string;
  readonly broker: string;
  readonly topic: string;
  readonly group?: string;
};

export type DbDialect = 'loki' | 'clickhouse' | 'bigquery' | 'other';

export type DbLogSource = {
  readonly kind: 'db';
  readonly id: SourceId;
  readonly name: string;
  readonly dialect: DbDialect;
  readonly url: string;
  readonly query: string;
};

export type SnapshotLogSource = {
  readonly kind: 'snapshot';
  readonly id: SourceId;
  readonly name: string;
  readonly archive: File;
};

export type LogSource =
  | FileLogSource
  | DirectoryLogSource
  | TextLogSource
  | UrlLogSource
  | StreamLogSource
  | RemoteSshLogSource
  | CloudLogSource
  | K8sLogSource
  | BusLogSource
  | DbLogSource
  | SnapshotLogSource;

export type LogSourceKind = LogSource['kind'];

export type LogSourceInput =
  | ({ kind: 'file'; name: string; size: number; file: File } & ParserOverride)
  | ({
      kind: 'directory';
      name: string;
      handle: FileSystemDirectoryHandle;
      glob?: string;
      watch?: boolean;
    } & ParserOverride)
  | ({ kind: 'text'; name: string; text: string } & ParserOverride)
  | ({
      kind: 'url';
      name: string;
      url: string;
      headers?: Readonly<Record<string, string>>;
    } & ParserOverride)
  | ({
      kind: 'stream';
      name: string;
      transport: 'ws' | 'sse';
      url: string;
    } & ParserOverride)
  | {
      kind: 'remote-ssh';
      name: string;
      host: string;
      user?: string;
      paths?: ReadonlyArray<string>;
      keyPath?: string;
    }
  | {
      kind: 'cloud';
      name: string;
      provider: CloudProvider;
      query?: string;
      region?: string;
    }
  | {
      kind: 'k8s';
      name: string;
      cluster: string;
      namespace?: string;
      pod?: string;
      container?: string;
    }
  | { kind: 'bus'; name: string; broker: string; topic: string; group?: string }
  | { kind: 'db'; name: string; dialect: DbDialect; url: string; query: string }
  | { kind: 'snapshot'; name: string; archive: File };

export type SourceStatus =
  | { kind: 'idle' }
  | { kind: 'queued' }
  | { kind: 'permission-required' }
  | { kind: 'loading'; bytesRead?: number; bytesTotal?: number }
  | { kind: 'indexing'; entriesIndexed: number }
  | { kind: 'streaming'; entriesIndexed: number }
  | { kind: 'done'; entryCount: number }
  | { kind: 'error'; error: { name: string; message: string } };

export interface SourceRecord {
  readonly source: LogSource;
  readonly status: SourceStatus;
  /**
   * Parser id resolved at ingest time (either auto-detected from the
   * first non-empty line or — once Phase 2.B lands — taken from
   * `source.parserId` override). `undefined` while the source is
   * still queued/loading and the parser hasn't been picked yet, or
   * for stub adapters that haven't produced any data.
   */
  readonly parserId?: string;
  /**
   * Columns the active parser would like to see first when the user
   * has no custom column selection yet. Drives the Phase 2.E
   * format-specific column auto-pick in
   * [LvAppContainer](../../app/containers/LvAppContainer.tsx).
   */
  readonly parserDefaultColumns?: ReadonlyArray<string>;
}
