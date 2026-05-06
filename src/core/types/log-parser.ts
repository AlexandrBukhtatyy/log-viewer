import type { EntryId, ParsedRecord, SourceId } from './log-entry.ts';

export interface ParseCtx {
  readonly sourceId: SourceId;
  nextId: () => EntryId;
  nextSeq: () => number;
  now: () => number;
}

export interface ParseResult {
  /**
   * `null` when the parser couldn't make sense of the line (and registry
   * fallback should try the next parser). Pointer fields (`filePath`,
   * `byteStart`, `byteEnd`) are added by the orchestrator after the parser
   * runs — see `ParsedRecord`.
   */
  readonly entry: ParsedRecord | null;
  readonly confidence: number;
}

export interface LogParser {
  readonly id: string;
  canParse: (line: string) => boolean;
  parseLine: (line: string, ctx: ParseCtx) => ParseResult;
}
