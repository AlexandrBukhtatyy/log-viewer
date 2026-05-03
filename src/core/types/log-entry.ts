export type LogLevel =
  | 'trace'
  | 'debug'
  | 'info'
  | 'warn'
  | 'error'
  | 'fatal'
  | 'unknown';

export type EntryId = string & { readonly __brand: 'EntryId' };
export type SourceId = string & { readonly __brand: 'SourceId' };

export interface LogEntry {
  readonly id: EntryId;
  readonly sourceId: SourceId;
  readonly seq: number;
  readonly timestamp: number | null;
  readonly level: LogLevel;
  readonly message: string;
  readonly raw: string;
  readonly fields: Readonly<Record<string, unknown>>;
}
