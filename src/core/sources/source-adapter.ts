import type { LogSource } from '../types/log-source.ts';

/**
 * One decoded log line as it leaves an adapter, with the byte range pointing
 * back to the storage object so the indexer can later resolve body lazily
 * without keeping the original text in SQLite (see ADR-0016).
 *
 * - `path` — for `directory` it's the forward-slash relative path from the
 *   directory root (`sub/a.log`); for chunked OPFS spools it's the chunk-seq
 *   stringified (`'0'`, `'1'`, …); for single-file sources and single-spool
 *   layouts it's `''`. Always a string.
 * - `byteStart` / `byteEnd` — byte offsets inside the storage object the
 *   `path` resolves to. `byteEnd` is exclusive and does NOT include trailing
 *   `\r\n` / `\n`. Phase 6 will start writing them into `entry.byte_start /
 *   byte_end` columns; for now they ride along the pipeline so adapters and
 *   parsers can be migrated independently.
 *
 * Downstream the orchestrator groups frames by `path`, and `path` ends up in
 * `LogEntry.filePath` (the `entry.file_path` SQL column) which the sidebar
 * filter targets via the `@file` field-key.
 */
export interface LogLineFrame {
  readonly path: string;
  readonly line: string;
  readonly byteStart: number;
  readonly byteEnd: number;
  /**
   * 1-based physical line number within `path`. Used downstream to stamp
   * `LogEntry.lineNumber` so the gutter and "Open at line" target the
   * actual line in the source file, not the global ingest sequence.
   * Counter resets when `path` changes — directory adapter creates a
   * fresh splitter per file; snapshot adapter resets explicitly; stream
   * adapter keeps a single running counter across its chunk-files since
   * the user perceives the source as one continuous log.
   */
  readonly lineNumber: number;
}

/**
 * Uniform contract for every log source. Adapter only knows how to produce a
 * stream of decoded line frames — parsing happens downstream in the parser
 * pool. Status updates are owned by the ingest-orchestrator, not the
 * adapter — adapters stay focused on opening/closing the underlying resource.
 */
export interface LogSourceAdapter {
  readonly source: LogSource;
  /** Open the source. Returns a ReadableStream of `{ path, line }` frames. */
  open: (signal: AbortSignal) => Promise<ReadableStream<LogLineFrame>>;
  /** Stop and release resources. Idempotent. */
  close: () => Promise<void>;
  /**
   * Update the set of "hot" relative paths the user is currently looking at.
   * Adapters that support per-file reordering (the directory adapter) will
   * pull these paths to the front of the read plan and preempt the in-flight
   * file when it's not in the hot set. Adapters that have nothing to reorder
   * (file/text/url/stream — single logical stream) can omit this method; the
   * orchestrator falls back to plain priority on the parser-pool queue.
   */
  setHotPaths?: (paths: ReadonlySet<string>) => void;
}

export type LogSourceAdapterFactory = (source: LogSource) => LogSourceAdapter;

/**
 * Wrap a `ReadableStream<string>` into a `ReadableStream<LogLineFrame>`,
 * tagging every line with the same `path` and synthetic byte ranges
 * computed from each line's UTF-8 byte length plus a single `\n` terminator.
 *
 * Synthetic offsets are honest enough for adapters that haven't been ported
 * to the byte-aware splitter yet — they describe a virtual write of every
 * emitted line back-to-back. When such an adapter later spools its bytes
 * into OPFS one line at a time (Phase 5+ for stream/url/etc), the same
 * offsets line up with the spool layout. Adapters with a real underlying
 * file (directory, file) skip this helper entirely and pipe their bytes
 * through `byte-line-splitter` to get genuine offsets.
 *
 * `path` is `''` for one-file sources and single-spool OPFS layouts. The
 * directory adapter always passes a non-empty relative path.
 */
export const tagLineStream = (
  source: ReadableStream<string>,
  path: string,
): ReadableStream<LogLineFrame> => {
  const encoder = new TextEncoder();
  let cursor = 0;
  let lineNo = 0;
  return source.pipeThrough(
    new TransformStream<string, LogLineFrame>({
      transform(line, controller) {
        const byteLen = encoder.encode(line).byteLength;
        const byteStart = cursor;
        const byteEnd = byteStart + byteLen;
        cursor = byteEnd + 1; // +1 for the synthetic `\n` terminator
        lineNo += 1;
        controller.enqueue({ path, line, byteStart, byteEnd, lineNumber: lineNo });
      },
    }),
  );
};
