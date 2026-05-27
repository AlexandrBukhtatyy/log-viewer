import type { LogEntry, SourceId } from '../types/index.ts';

export interface ParseRequestCtx {
  readonly sourceId: SourceId;
  readonly startSeq: number;
  readonly parserId?: string;
  /**
   * For sources with inner file structure (currently only `directory` and
   * `snapshot`), the forward-slash relative path inside the source root.
   * The parser-api stamps it onto `LogEntry.filePath` (and the
   * `entry.file_path` SQL column) — the sidebar filters by this column
   * via the `@file` field-key. Sources without sub-structure leave it
   * `undefined`.
   */
  readonly filePath?: string;
}

/**
 * Input frame for `parse()`. Carries the line text plus the byte range it
 * occupies in the underlying storage (FS file or OPFS spool). The parser
 * only sees `line`; the parser-worker shim stamps `byteStart`/`byteEnd`
 * onto the resulting LogEntry as the offset-pointer used at read time.
 */
export interface ParseLineFrame {
  readonly line: string;
  readonly byteStart: number;
  readonly byteEnd: number;
  /**
   * 1-based physical line number of this frame within its source file.
   * Carried straight through from `LogLineFrame.lineNumber`; for
   * multi-line records folded by the orchestrator's continuation
   * machinery, the combined frame keeps the lineNumber of the first
   * physical line of the block.
   */
  readonly lineNumber: number;
}

/**
 * Static metadata about a registered parser, surfaced to the
 * orchestrator so it can wire multi-line accumulation without
 * snapshotting the whole parser instance over Comlink. Strings only
 * — regex sources, not compiled `RegExp` — to stay
 * structured-cloneable.
 */
export interface ParserMeta {
  readonly id: string;
  readonly continuationRegex: string | null;
  readonly defaultColumns: ReadonlyArray<string>;
}

export interface ParserApi {
  ping: () => Promise<string>;
  detectParser: (sample: ReadonlyArray<string>) => Promise<string>;
  /** Returns meta for a parser by id. `null` when no such parser is registered. */
  getParserMeta: (parserId: string) => Promise<ParserMeta | null>;
  /** Enumerate all registered parsers; sorted by registration priority (descending). */
  listParsers: () => Promise<ReadonlyArray<ParserMeta>>;
  /**
   * Replace the worker's custom-parser registrations with `defs`
   * (Phase 2.C). Definitions arrive as plain JSON (cloneable over
   * Comlink); the worker compiles them via `compileCustomParser` and
   * inserts into the registry at priority 50. Idempotent: calling
   * with the same list is a no-op.
   */
  loadCustomParsers: (
    defs: ReadonlyArray<import('../parsers/custom-parser-def.ts').CustomParserDef>,
  ) => Promise<void>;
  parse: (
    lines: ReadonlyArray<ParseLineFrame>,
    ctx: ParseRequestCtx,
  ) => Promise<ReadonlyArray<LogEntry>>;
}
