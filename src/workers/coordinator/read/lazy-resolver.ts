import type { ParseLineFrame } from '../../../core/rpc/parser.contract.ts';
import type {
  EntryId,
  LogEntry,
  LogSource,
  SourceId,
} from '../../../core/types/index.ts';
import type { ParserPool } from '../pool/parser-pool.ts';
import {
  FileSourceReader,
  FsHandleReader,
  OpfsChunkedSpoolReader,
  OpfsSingleSpoolReader,
  type SourceBlobReader,
} from '../storage/source-blob-reader.ts';

/**
 * Lazy-resolver layer (ADR-0016): the indexer hands out `LogEntry` shells
 * that carry the byte pointer (`filePath` / `byteStart` / `byteEnd`) but
 * blank `raw` / `message`. Before forwarding to the UI we slice the bytes
 * out of the source's underlying storage and re-parse the line so
 * `message` is reconstructed.
 *
 * Reader selection:
 *   - directory / file → FsHandleReader / FileSourceReader (no copy)
 *   - text / pasted / snapshot / url → OpfsSingleSpoolReader
 *   - stream → OpfsChunkedSpoolReader
 *   - sources whose adapter doesn't yet spool to OPFS get null and the
 *     resolver falls back to leaving `raw`/`message` blank — so the UI
 *     keeps rendering rows even when bodies aren't yet recoverable.
 */
export type SourceLookup = (sourceId: SourceId) => LogSource | null;

const readerForSource = (source: LogSource): SourceBlobReader | null => {
  switch (source.kind) {
    case 'directory':
      return new FsHandleReader(source.handle);
    case 'file':
      return new FileSourceReader(source.file);
    case 'snapshot':
      return new FileSourceReader(source.archive);
    case 'text':
    case 'url':
      return new OpfsSingleSpoolReader(source.id);
    case 'stream':
      return new OpfsChunkedSpoolReader(source.id);
    case 'remote-ssh':
    case 'cloud':
    case 'k8s':
    case 'bus':
    case 'db':
      return null;
  }
};

const blankBody = (row: LogEntry): LogEntry =>
  row.raw === '' && row.message === '' ? row : { ...row, raw: '', message: '' };

export const resolvePointersToEntries = async (
  rows: ReadonlyArray<LogEntry>,
  lookupSource: SourceLookup,
  parserPool: ParserPool,
): Promise<ReadonlyArray<LogEntry>> => {
  if (rows.length === 0) return rows;

  // Pre-v3 / handle-less rows (no real pointer info) come through as
  // already-final entries. Avoid roundtripping them through the resolver.
  const needsResolve: LogEntry[] = [];
  const passthrough = new Map<EntryId, LogEntry>();
  for (const r of rows) {
    if (r.byteEnd > r.byteStart) needsResolve.push(r);
    else passthrough.set(r.id, r);
  }
  if (needsResolve.length === 0) return rows;

  // Group by source — each source has at most one reader instance per
  // resolve call, and parser-RPC is one batch per source.
  const groups = new Map<SourceId, LogEntry[]>();
  for (const r of needsResolve) {
    const list = groups.get(r.sourceId) ?? [];
    list.push(r);
    groups.set(r.sourceId, list);
  }

  const enriched = new Map<EntryId, LogEntry>();

  for (const [sourceId, srows] of groups) {
    const source = lookupSource(sourceId);
    const reader = source ? readerForSource(source) : null;
    if (!reader) {
      for (const r of srows) enriched.set(r.id, blankBody(r));
      continue;
    }

    // Read each row's bytes. Failures keep the row in the output but with a
    // blank body — ingest pointers can outlive the FS handle (e.g. browser
    // released access after a permission-required reload).
    const frames: (ParseLineFrame | null)[] = await Promise.all(
      srows.map(async (r): Promise<ParseLineFrame | null> => {
        try {
          const line = await reader.read(r.filePath, r.byteStart, r.byteEnd);
          return { line, byteStart: r.byteStart, byteEnd: r.byteEnd };
        } catch (err) {
          console.warn(
            `[lazy-resolver] read failed for ${sourceId}::${r.filePath} [${r.byteStart}, ${r.byteEnd}):`,
            err instanceof Error ? err.message : err,
          );
          return null;
        }
      }),
    );

    // Batch-parse so message gets reconstructed in one parser-pool RPC.
    const goodFrames: ParseLineFrame[] = [];
    const goodIdx: number[] = [];
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      if (f !== null) {
        goodFrames.push(f);
        goodIdx.push(i);
      }
    }

    const parsed =
      goodFrames.length > 0
        ? await parserPool.withWorker((p) =>
            p.parse(goodFrames, {
              sourceId,
              startSeq: 0,
            }),
          )
        : [];

    // Map parser output back to original rows by index. Parser may drop
    // un-parseable lines — fall back to raw=line, message=line so the UI
    // still has something to show.
    let parsedIdx = 0;
    for (let i = 0; i < srows.length; i++) {
      const row = srows[i]!;
      const frame = frames[i];
      if (frame === null) {
        enriched.set(row.id, blankBody(row));
        continue;
      }
      // The parser preserves input order; `parsed` may be shorter when
      // empty/unrecognised lines were skipped, so we walk it sparsely
      // alongside `goodIdx`.
      let message = frame.line;
      while (parsedIdx < parsed.length) {
        const p = parsed[parsedIdx]!;
        if (p.byteStart === row.byteStart && p.byteEnd === row.byteEnd) {
          message = p.message;
          parsedIdx++;
          break;
        }
        // Parser dropped something earlier — advance until we find the
        // record matching this frame, or run out.
        if (p.byteStart < row.byteStart) {
          parsedIdx++;
          continue;
        }
        break;
      }
      enriched.set(row.id, { ...row, raw: frame.line, message });
    }
  }

  // Re-emit in the original order.
  return rows.map((r) => enriched.get(r.id) ?? passthrough.get(r.id) ?? r);
};
