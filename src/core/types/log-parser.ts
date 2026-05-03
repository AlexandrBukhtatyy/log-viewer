import type { EntryId, LogEntry, SourceId } from './log-entry.ts';

export interface ParseCtx {
  readonly sourceId: SourceId;
  nextId: () => EntryId;
  nextSeq: () => number;
  now: () => number;
}

export interface ParseResult {
  readonly entry: LogEntry | null;
  readonly confidence: number;
}

export interface LogParser {
  readonly id: string;
  canParse: (line: string) => boolean;
  parseLine: (line: string, ctx: ParseCtx) => ParseResult;
}
