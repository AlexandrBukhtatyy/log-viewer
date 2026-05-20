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
  OpfsArchiveSpoolReader,
  OpfsChunkedSpoolReader,
  OpfsSingleSpoolReader,
  type SourceBlobReader,
} from '../../../core/storage/source-blob-reader.ts';

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
      // Each archive member was spooled to its own OPFS file by
      // snapshot-adapter; the reader un-flattens member names.
      return new OpfsArchiveSpoolReader(source.id);
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

  // Group by (source, filePath). Same-file ranges share one reader call —
  // see source-blob-reader.readBatch / ADR-0020. For directory sources the
  // window of pointer rows can span multiple files; mixing them into one
  // batch would either re-walk the dir tree per range (old behaviour) or
  // read the wrong file. Same-source groups still share one parser RPC.
  const sourceGroups = new Map<SourceId, LogEntry[]>();
  const fileGroups = new Map<SourceId, Map<string, LogEntry[]>>();
  for (const r of needsResolve) {
    const sList = sourceGroups.get(r.sourceId) ?? [];
    sList.push(r);
    sourceGroups.set(r.sourceId, sList);

    let perFile = fileGroups.get(r.sourceId);
    if (!perFile) {
      perFile = new Map<string, LogEntry[]>();
      fileGroups.set(r.sourceId, perFile);
    }
    const fList = perFile.get(r.filePath) ?? [];
    fList.push(r);
    perFile.set(r.filePath, fList);
  }

  const enriched = new Map<EntryId, LogEntry>();

  for (const [sourceId, srows] of sourceGroups) {
    const source = lookupSource(sourceId);
    const reader = source ? readerForSource(source) : null;
    if (!reader) {
      for (const r of srows) enriched.set(r.id, blankBody(r));
      continue;
    }

    // For each filePath inside the source, one batched read fills in lines
    // for all its rows. Failures keep the rows in the output but with a
    // blank body — ingest pointers can outlive the FS handle (e.g. browser
    // released access after a permission-required reload).
    const lineByEntryId = new Map<EntryId, string>();
    const perFile = fileGroups.get(sourceId)!;
    await Promise.all(
      Array.from(perFile, async ([filePath, rows]) => {
        try {
          const lines = await reader.readBatch(
            filePath,
            rows.map((r) => ({ byteStart: r.byteStart, byteEnd: r.byteEnd })),
          );
          for (let i = 0; i < rows.length; i++) {
            const line = lines[i];
            if (line !== undefined) lineByEntryId.set(rows[i]!.id, line);
          }
        } catch (err) {
          console.warn(
            `[lazy-resolver] readBatch failed for ${sourceId}::${filePath} (${rows.length} ranges):`,
            err instanceof Error ? err.message : err,
          );
        }
      }),
    );

    // Build frames in `srows` order (matters for parser output alignment).
    const frames: (ParseLineFrame | null)[] = srows.map((r) => {
      const line = lineByEntryId.get(r.id);
      if (line === undefined) return null;
      return { line, byteStart: r.byteStart, byteEnd: r.byteEnd };
    });

    // Batch-parse so message gets reconstructed in one parser-pool RPC.
    const goodFrames: ParseLineFrame[] = [];
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      if (f !== null) goodFrames.push(f);
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
      // empty/unrecognised lines were skipped, so we walk it sparsely.
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
