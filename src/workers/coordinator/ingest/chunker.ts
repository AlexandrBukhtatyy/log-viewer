import type { LogLineFrame } from '../../../core/sources/source-adapter.ts';
import type { ParseLineFrame } from '../../../core/rpc/parser.contract.ts';

export interface ChunkerOptions {
  /** Flush a batch when it reaches this many lines. */
  readonly maxLines: number;
  /** Or when this many ms have passed since first line of the current batch. */
  readonly maxMs: number;
}

export interface LineBatch {
  /**
   * Path of every line in the batch. Empty string for one-file sources and
   * single-spool layouts; relative path inside the source for directory; the
   * chunk-seq stringified for chunked OPFS spools (stream).
   */
  readonly path: string;
  /** Lines plus their byte ranges in the underlying storage. */
  readonly lines: ReadonlyArray<ParseLineFrame>;
}

/**
 * TransformStream<LogLineFrame, LineBatch> — accumulates frames into
 * homogenous-`path` batches and emits a batch whenever:
 *   (a) batch reaches `maxLines`,
 *   (b) `maxMs` have passed since the first frame of the current batch, or
 *   (c) the next frame's `path` differs from the batch's — the batch is
 *       flushed first, and the new frame starts a fresh batch.
 *
 * Empty lines are dropped here — parsers also skip them, but dropping at this
 * layer keeps batches dense and avoids wasted RPC.
 *
 * Path-homogenous batches are required so the per-batch ParseRequestCtx can
 * carry one `filePath` to the parser worker; mixing files in a batch would
 * mistag entries.
 */
export const createChunker = (
  options: ChunkerOptions,
): TransformStream<LogLineFrame, LineBatch> => {
  const { maxLines, maxMs } = options;
  let batch: ParseLineFrame[] = [];
  let batchPath = '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastController: TransformStreamDefaultController<LineBatch> | null = null;

  const emit = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (batch.length > 0 && lastController !== null) {
      lastController.enqueue({ path: batchPath, lines: batch });
      batch = [];
    }
  };

  return new TransformStream<LogLineFrame, LineBatch>({
    transform(frame, controller) {
      lastController = controller;
      if (frame.line === '') return;
      // Flush on path change so each batch is homogenous.
      if (batch.length > 0 && frame.path !== batchPath) {
        emit();
      }
      if (batch.length === 0) batchPath = frame.path;
      batch.push({
        line: frame.line,
        byteStart: frame.byteStart,
        byteEnd: frame.byteEnd,
        lineNumber: frame.lineNumber,
      });
      if (batch.length >= maxLines) {
        emit();
      } else if (timer === null) {
        timer = setTimeout(emit, maxMs);
      }
    },
    flush(controller) {
      lastController = controller;
      emit();
    },
  });
};
