import type { SourceId } from './log-entry.ts';

export type FileLogSource = {
  readonly kind: 'file';
  readonly id: SourceId;
  readonly name: string;
  readonly size: number;
  readonly file: File;
};

export type DirectoryLogSource = {
  readonly kind: 'directory';
  readonly id: SourceId;
  readonly name: string;
  readonly handle: FileSystemDirectoryHandle;
  readonly glob?: string;
};

export type TextLogSource = {
  readonly kind: 'text';
  readonly id: SourceId;
  readonly name: string;
  readonly text: string;
};

export type UrlLogSource = {
  readonly kind: 'url';
  readonly id: SourceId;
  readonly name: string;
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
};

export type StreamLogSource = {
  readonly kind: 'stream';
  readonly id: SourceId;
  readonly name: string;
  readonly transport: 'ws' | 'sse';
  readonly url: string;
};

export type LogSource =
  | FileLogSource
  | DirectoryLogSource
  | TextLogSource
  | UrlLogSource
  | StreamLogSource;

export type LogSourceKind = LogSource['kind'];

export type LogSourceInput =
  | { kind: 'file'; name: string; size: number; file: File }
  | { kind: 'directory'; name: string; handle: FileSystemDirectoryHandle; glob?: string }
  | { kind: 'text'; name: string; text: string }
  | { kind: 'url'; name: string; url: string; headers?: Readonly<Record<string, string>> }
  | { kind: 'stream'; name: string; transport: 'ws' | 'sse'; url: string };

export type SourceStatus =
  | { kind: 'idle' }
  | { kind: 'permission-required' }
  | { kind: 'loading'; bytesRead?: number; bytesTotal?: number }
  | { kind: 'indexing'; entriesIndexed: number }
  | { kind: 'streaming'; entriesIndexed: number }
  | { kind: 'done'; entryCount: number }
  | { kind: 'error'; error: { name: string; message: string } };

export interface SourceRecord {
  readonly source: LogSource;
  readonly status: SourceStatus;
}
