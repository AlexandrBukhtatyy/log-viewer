import type * as Comlink from 'comlink';
import type { IndexerApi } from '../../../core/rpc/indexer.contract.ts';
import type {
  LogLineFrame,
  LogSourceAdapter,
} from '../../../core/sources/source-adapter.ts';
import type { LogSource, SourceStatus } from '../../../core/types/log-source.ts';
import type { ParserPool } from '../pool/parser-pool.ts';

export interface IngestParams {
  readonly source: LogSource;
  readonly adapter: LogSourceAdapter;
  readonly parserPool: ParserPool;
  readonly indexer: Comlink.Remote<IndexerApi>;
  readonly signal: AbortSignal;
  readonly onStatus: (status: SourceStatus) => void;
  readonly onChange: () => void;
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
  const { source, adapter, parserPool, indexer, signal, onStatus, onChange } = params;

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
  let entriesIndexed = 0;
  let seq = 0;

  const isStream = source.kind === 'stream';
  const progressStatus = (n: number): SourceStatus =>
    isStream
      ? { kind: 'streaming', entriesIndexed: n }
      : { kind: 'indexing', entriesIndexed: n };

  onStatus(progressStatus(entriesIndexed));

  try {
    while (true) {
      if (signal.aborted) break;

      const { value: batch, done } = await reader.read();
      if (done) break;
      if (batch === undefined || batch.lines.length === 0) continue;
      const { lines, path } = batch;

      // Detect parser on the first non-empty batch.
      if (parserId === null) {
        const sample = lines.slice(0, SAMPLE_LINES_FOR_DETECT);
        parserId = await parserPool.withWorker((p) => p.detectParser(sample));
      }

      const startSeq = seq;
      seq += lines.length;

      const detectedParserId = parserId;
      const entries = await parserPool.withWorker((p) =>
        p.parse(lines, {
          sourceId: source.id,
          startSeq,
          parserId: detectedParserId,
          filePath: path ?? undefined,
        }),
      );

      if (entries.length === 0) continue;

      await indexer.insertBatch(entries);
      entriesIndexed += entries.length;
      onStatus(progressStatus(entriesIndexed));
      onChange();
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
