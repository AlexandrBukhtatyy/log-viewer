import type * as Comlink from 'comlink';
import type { IndexerApi } from '../../../core/rpc/indexer.contract.ts';
import type { ParseLineFrame } from '../../../core/rpc/parser.contract.ts';
import type {
  LogLineFrame,
  LogSourceAdapter,
} from '../../../core/sources/source-adapter.ts';
import type { LogEntry } from '../../../core/types/log-entry.ts';
import type { LogSource, SourceStatus } from '../../../core/types/log-source.ts';
import type { ParserPool, ParserPriority } from '../pool/parser-pool.ts';

export interface IngestParams {
  readonly source: LogSource;
  readonly adapter: LogSourceAdapter;
  readonly parserPool: ParserPool;
  readonly indexer: Comlink.Remote<IndexerApi>;
  readonly signal: AbortSignal;
  readonly onStatus: (status: SourceStatus) => void;
  readonly onChange: () => void;
  /**
   * Fires once when the orchestrator first picks a parser for this
   * source (either auto-detect on first batch or — once Phase 2.B
   * lands — the per-source override). Coordinator uses it to surface
   * `@parser.id` to the UI and trigger the format-specific column
   * preset in [LvAppContainer](../../../app/containers/LvAppContainer.tsx).
   */
  readonly onParserDetected?: (
    info: { readonly parserId: string; readonly defaultColumns: ReadonlyArray<string> },
  ) => void;
  /**
   * Priority hint for the parser-pool slot that handles each batch.
   * Called per-batch with the relative `filePath` (empty string for
   * single-file sources). Defaults to `'normal'` when omitted.
   */
  readonly getPriority?: (filePath: string) => ParserPriority;
}

const CHUNKER_OPTS = { maxLines: 1000, maxMs: 100 } as const;
const SAMPLE_LINES_FOR_DETECT = 5;

const formatError = (err: unknown): { name: string; message: string } => ({
  name: err instanceof Error ? err.name : 'IngestError',
  message: err instanceof Error ? err.message : String(err),
});

/**
 * Drive the source → chunker → parser-pool → indexer pipeline for a single source.
 * Status updates are emitted via onStatus; insertBatch completions via onChange.
 *
 * Errors during open/parse/insert are surfaced as a final 'error' status. Aborts
 * (signal) are silent and just stop the loop.
 */
export const ingestSource = async (params: IngestParams): Promise<void> => {
  const {
    source,
    adapter,
    parserPool,
    indexer,
    signal,
    onStatus,
    onChange,
    onParserDetected,
    getPriority,
  } = params;

  const priorityFor = (path: string): ParserPriority =>
    getPriority ? getPriority(path) : 'normal';

  // Lazy-import chunker to keep this file dep-free of TransformStream when reused in node tests.
  const { createChunker } = await import('./chunker.ts');

  onStatus({ kind: 'loading' });

  let lineStream: ReadableStream<LogLineFrame>;
  try {
    lineStream = await adapter.open(signal);
  } catch (err) {
    onStatus({ kind: 'error', error: formatError(err) });
    return;
  }

  const reader = lineStream
    .pipeThrough(createChunker(CHUNKER_OPTS))
    .getReader();

  let parserId: string | null = null;
  let continuationRegex: RegExp | null = null;
  let entriesIndexed = 0;
  let seq = 0;

  const isStream = source.kind === 'stream';
  const progressStatus = (n: number): SourceStatus =>
    isStream
      ? { kind: 'streaming', entriesIndexed: n }
      : { kind: 'indexing', entriesIndexed: n };

  onStatus(progressStatus(entriesIndexed));

  // Multi-line buffer (Phase 2.D).
  //
  // When the active parser declares `continuationRegex`, consecutive
  // physical lines that match it are folded into the same logical
  // record. We hold the open frame here, append continuations into
  // `cont`, and flush either on a non-matching line or on a path
  // change (continuations don't cross files in a directory source).
  // The flushed frame ships to parser-pool as one line with `\n`
  // embedded; the multi-line parser splits it back inside `parseBlock`.
  let openFrame: ParseLineFrame | null = null;
  let cont: ParseLineFrame[] = [];
  let openPath: string | null = null;

  // Per-(source, file) running entry counter so `LogEntry.fileSeq` is a
  // dense 1-based ordinal inside its file regardless of which physical
  // lines the parser ended up emitting records for. The parser doesn't
  // know about previously-ingested records, so the orchestrator owns
  // this — `parser-api.enrich` writes `fileSeq: 0` and we overwrite it
  // here. Keyed by the same `filePath` we already pass to parse(); empty
  // string for single-file/spool sources.
  const fileSeqByPath = new Map<string, number>();
  const stampFileSeq = (entry: LogEntry): LogEntry => {
    const key = entry.filePath;
    const next = (fileSeqByPath.get(key) ?? 0) + 1;
    fileSeqByPath.set(key, next);
    return { ...entry, fileSeq: next };
  };

  const buildCombinedFrame = (): ParseLineFrame | null => {
    if (openFrame === null) return null;
    const tail = cont.length > 0 ? cont[cont.length - 1]! : openFrame;
    const text =
      cont.length === 0
        ? openFrame.line
        : [openFrame.line, ...cont.map((c) => c.line)].join('\n');
    return {
      line: text,
      byteStart: openFrame.byteStart,
      byteEnd: tail.byteEnd,
      // Keep the lineNumber of the block's first physical line — the
      // gutter and "Open at line" target that line, not the
      // continuations.
      lineNumber: openFrame.lineNumber,
    };
  };

  const flushOpen = (out: ParseLineFrame[]): void => {
    const combined = buildCombinedFrame();
    if (combined !== null) out.push(combined);
    openFrame = null;
    cont = [];
  };

  /** Fold a batch through the continuation pattern, producing the
   *  frames that should go to parser-pool. Open frame at the end of
   *  the batch stays in the buffer for the next batch. */
  const foldBatch = (
    lines: ReadonlyArray<ParseLineFrame>,
    path: string,
  ): ReadonlyArray<ParseLineFrame> => {
    if (continuationRegex === null) return lines;
    // Path boundary — directory sources rotate per-file, and stack
    // continuations can't cross those.
    if (openPath !== null && openPath !== path && openFrame !== null) {
      const flushed: ParseLineFrame[] = [];
      flushOpen(flushed);
      openPath = path;
      const folded = foldBatch(lines, path);
      return [...flushed, ...folded];
    }
    openPath = path;

    const out: ParseLineFrame[] = [];
    for (const frame of lines) {
      const isCont = continuationRegex.test(frame.line);
      if (isCont && openFrame !== null) {
        cont.push(frame);
        continue;
      }
      // Non-continuation line — flush the previous record (if any) and
      // start a new one anchored on this frame.
      flushOpen(out);
      openFrame = frame;
    }
    return out;
  };

  try {
    while (true) {
      if (signal.aborted) break;

      const { value: batch, done } = await reader.read();
      if (done) break;
      if (batch === undefined || batch.lines.length === 0) continue;
      const { lines, path } = batch;

      // Detect parser on the first non-empty batch. Once we know which
      // parser owns this source, grab its multi-line continuation
      // pattern (if any) so the fold loop below can act on it.
      if (parserId === null) {
        // Honor per-source override (Phase 2.B) — if the user (or a
        // persisted handle) names a parser explicitly, skip detection
        // and just trust the choice. Auto-detect remains the default
        // when no override is set.
        const detectionPriority = priorityFor(path);
        if ('parserId' in source && source.parserId) {
          parserId = source.parserId;
        } else {
          const sample = lines
            .slice(0, SAMPLE_LINES_FOR_DETECT)
            .map((f) => f.line);
          parserId = await parserPool.withWorker(
            (p) => p.detectParser(sample),
            detectionPriority,
          );
        }
        const detected = parserId;
        const meta = await parserPool.withWorker(
          (p) => p.getParserMeta(detected),
          detectionPriority,
        );
        if (meta?.continuationRegex) {
          try {
            continuationRegex = new RegExp(meta.continuationRegex);
          } catch (err) {
            console.warn(
              `[ingest] parser '${detected}' has malformed continuationRegex; ignoring`,
              err,
            );
            continuationRegex = null;
          }
        }
        onParserDetected?.({
          parserId: detected,
          defaultColumns: meta?.defaultColumns ?? [],
        });
      }

      const folded = foldBatch(lines, path);
      if (folded.length === 0) continue;

      const startSeq = seq;
      seq += folded.length;

      const detectedParserId = parserId;
      const entries = await parserPool.withWorker(
        (p) =>
          p.parse(folded, {
            sourceId: source.id,
            startSeq,
            parserId: detectedParserId,
            filePath: path === '' ? undefined : path,
          }),
        priorityFor(path),
      );

      if (entries.length === 0) continue;

      const stamped = entries.map(stampFileSeq);
      await indexer.insertBatch(stamped);
      entriesIndexed += stamped.length;
      onStatus(progressStatus(entriesIndexed));
      onChange();
    }

    // Flush any record still buffered at EOF.
    if (openFrame !== null && parserId !== null) {
      const tail: ParseLineFrame[] = [];
      flushOpen(tail);
      if (tail.length > 0) {
        const startSeq = seq;
        seq += tail.length;
        const detectedParserId = parserId;
        const path = openPath ?? '';
        const entries = await parserPool.withWorker(
          (p) =>
            p.parse(tail, {
              sourceId: source.id,
              startSeq,
              parserId: detectedParserId,
              filePath: path === '' ? undefined : path,
            }),
          priorityFor(path),
        );
        if (entries.length > 0) {
          const stamped = entries.map(stampFileSeq);
          await indexer.insertBatch(stamped);
          entriesIndexed += stamped.length;
          onChange();
        }
      }
    }

    // Emit `done` even on abort — partial entries are real and indexed; UI
    // shows the partial count instead of getting stuck on `indexing…`.
    onStatus({ kind: 'done', entryCount: entriesIndexed });
  } catch (err) {
    if (signal.aborted) {
      onStatus({ kind: 'done', entryCount: entriesIndexed });
      return;
    }
    onStatus({ kind: 'error', error: formatError(err) });
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* reader already closed */
    }
    await adapter.close();
  }
};
