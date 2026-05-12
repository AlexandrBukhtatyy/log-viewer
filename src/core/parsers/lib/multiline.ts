import type { LogParser, ParseResult } from '../../types/log-parser.ts';

/**
 * Parser that consumes multi-line records (one logical entry made of
 * several physical lines — e.g. JVM stacktraces, Python tracebacks,
 * multi-line JSON). The factory wraps a regex-based «is this line a
 * continuation?» predicate and a `parseBlock(lines, ctx)` callback
 * that builds the final entry from the accumulated lines.
 *
 * Wiring lives in two places:
 *   1. The parser exposes `continuationRegex` (a regex source string,
 *      structured-cloneable so it survives the worker boundary).
 *   2. The ingest orchestrator buffers consecutive matching lines and
 *      feeds the parser one joined `parseLine` call (with embedded
 *      `\n`). The `parseLine` implementation here splits the block
 *      back into lines for `parseBlock`.
 *
 * Until the orchestrator's continuation-buffer lands (Phase 2.D of
 * the multi-format roadmap), parsers built with this factory still
 * work — just not as multi-line: every physical line goes through
 * `parseBlock` as a single-element array.
 */
export interface MultilineParserSpec {
  readonly id: string;
  /** Opens a new record. Typically anchored at the start (`^\w+Error:`). */
  readonly isOpen: (line: string) => boolean;
  /**
   * Recognises a continuation line. Combined into `continuationRegex`
   * for the orchestrator and used directly when `parseLine` receives
   * an already-joined block.
   */
  readonly continuationPattern: RegExp;
  readonly parseBlock: (
    lines: ReadonlyArray<string>,
    rawBlock: string,
    ctx: import('../../types/log-parser.ts').ParseCtx,
  ) => ParseResult;
  readonly defaultColumns?: ReadonlyArray<string>;
}

export const defineMultilineParser = (spec: MultilineParserSpec): LogParser => ({
  id: spec.id,
  canParse: (line) => spec.isOpen(line),
  parseLine: (line, ctx) => {
    // The orchestrator joins physical lines with `\n` before handing
    // the block over. When this parser is used outside that pipeline
    // (e.g. a unit test that pushes one line at a time), we still
    // produce a sensible single-line entry by falling through with a
    // one-element array.
    const lines = line.includes('\n') ? line.split('\n') : [line];
    return spec.parseBlock(lines, line, ctx);
  },
  continuationRegex: spec.continuationPattern.source,
  defaultColumns: spec.defaultColumns,
});
