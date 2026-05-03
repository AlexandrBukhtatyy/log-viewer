import type { LogEntry, SourceId } from '../types/index.ts';

export interface ParseRequestCtx {
  readonly sourceId: SourceId;
  readonly startSeq: number;
  readonly parserId?: string;
}

export interface ParserApi {
  ping: () => Promise<string>;
  detectParser: (sample: ReadonlyArray<string>) => Promise<string>;
  parse: (
    lines: ReadonlyArray<string>,
    ctx: ParseRequestCtx,
  ) => Promise<ReadonlyArray<LogEntry>>;
}
