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
  /**
   * Multi-line continuation marker. When present, the ingest
   * orchestrator buffers consecutive physical lines that match this
   * pattern and feeds the parser one *joined* block (with embedded
   * `\n`) instead of each line individually. `parseLine` should be
   * written to expect that joined input.
   *
   * Stored as a regex source string (not `RegExp`) so it can be
   * shipped across the worker boundary via Comlink — `RegExp`
   * instances aren't structured-cloneable.
   */
  readonly continuationRegex?: string;
  /**
   * Optional default columns that a UI may suggest when a source is
   * detected as this parser's format. Picker still wins if the user
   * overrides; this just seeds a sensible first-paint layout.
   */
  readonly defaultColumns?: ReadonlyArray<string>;
}
