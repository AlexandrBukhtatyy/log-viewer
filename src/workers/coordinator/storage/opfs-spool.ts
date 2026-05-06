import type { SourceId } from '../../../core/types/index.ts';

/**
 * OPFS spool — temporary byte storage for sources whose data does not live in
 * a user-picked file (text/pasted/snapshot/url/stream). The indexer stores
 * `(file_path, byte_start, byte_end)` pointers; at read time the same bytes
 * are sliced back via `OpfsSingleSpoolReader` / `OpfsChunkedSpoolReader`.
 *
 * Layout — one directory per source, always:
 *   lv-spool/<sourceId>/data.bin        — single-spool (text/pasted/snapshot/url)
 *   lv-spool/<sourceId>/<seq>.bin       — chunked-spool (stream)
 *
 * Why per-source directories:
 * - Removal collapses to a single `removeEntry(sourceId, {recursive:true})`
 *   regardless of mode.
 * - Future per-source artefacts (manifest, watch-mode resume cursor,
 *   index sidecars) can sit alongside `data.bin` / chunk files without a
 *   second naming convention.
 * - Resume after reload: enumerate the source's directory to find
 *   surviving chunks instead of probing flat-file names.
 *
 * Why still two writers:
 * - One-shot sources push the entire payload at once (or nearly so).
 *   Append-once-into-one-file (`data.bin`) is the simplest sane layout.
 * - Streaming sources push packets continuously while the reader is also
 *   reading earlier bytes for display. Writing into a single growing file
 *   contends on the same `FileSystemWritableFileStream`, while
 *   chunk-per-packet keeps writer and reader on different files entirely.
 */

export const SPOOL_ROOT = 'lv-spool';
/** File name used by `OpfsSingleSpoolWriter`/`Reader` inside a source's dir. */
export const SINGLE_SPOOL_FILE = 'data.bin';

/**
 * Indirection for tests: production code uses `navigator.storage.getDirectory()`,
 * tests inject an in-memory mock that satisfies the same interface.
 */
export interface OpfsRootProvider {
  getRoot(): Promise<FileSystemDirectoryHandle>;
}

export const defaultOpfsRoot: OpfsRootProvider = {
  getRoot: () => navigator.storage.getDirectory(),
};

/**
 * Single-file spool. Truncates on open, appends sequentially during ingest,
 * closes once the source is fully ingested. `byteStart`/`byteEnd` returned by
 * `write()` are absolute positions inside the spool file — they go straight
 * into `entry_v3` pointer rows.
 */
export class OpfsSingleSpoolWriter {
  readonly sourceId: SourceId;
  private writable: FileSystemWritableFileStream | null = null;
  private cursor = 0;

  private constructor(sourceId: SourceId) {
    this.sourceId = sourceId;
  }

  static async open(
    sourceId: SourceId,
    rootProvider: OpfsRootProvider = defaultOpfsRoot,
  ): Promise<OpfsSingleSpoolWriter> {
    const root = await rootProvider.getRoot();
    const spoolDir = await root.getDirectoryHandle(SPOOL_ROOT, { create: true });
    const sourceDir = await spoolDir.getDirectoryHandle(sourceId, { create: true });
    const fh = await sourceDir.getFileHandle(SINGLE_SPOOL_FILE, { create: true });
    const writer = new OpfsSingleSpoolWriter(sourceId);
    writer.writable = await fh.createWritable({ keepExistingData: false });
    return writer;
  }

  async write(
    bytes: Uint8Array,
  ): Promise<{ byteStart: number; byteEnd: number }> {
    if (this.writable === null) {
      throw new Error('OpfsSingleSpoolWriter: writer is closed');
    }
    if (bytes.byteLength === 0) {
      return { byteStart: this.cursor, byteEnd: this.cursor };
    }
    await this.writable.write(bytes as Uint8Array<ArrayBuffer>);
    const byteStart = this.cursor;
    const byteEnd = byteStart + bytes.byteLength;
    this.cursor = byteEnd;
    return { byteStart, byteEnd };
  }

  async close(): Promise<void> {
    if (this.writable === null) return;
    await this.writable.close();
    this.writable = null;
  }
}

/**
 * Chunk-per-packet spool. Each call to `pushChunk` writes a self-contained
 * file `lv-spool/<sourceId>/<chunkSeq>.bin` and returns the chunk identifier
 * plus its byte size. The caller is responsible for splitting an inbound
 * packet on `\n` boundaries (so each chunk holds whole lines) — see
 * `byte-line-splitter` for the typical downstream consumer.
 *
 * `chunkSeq` increments monotonically per writer instance. On reload the
 * caller scans the source's spool directory and resumes from `max(seq) + 1`
 * — but resume logic itself lives outside this class.
 */
export class OpfsChunkedSpoolWriter {
  readonly sourceId: SourceId;
  private readonly sourceDir: FileSystemDirectoryHandle;
  private chunkSeq = 0;

  private constructor(
    sourceId: SourceId,
    sourceDir: FileSystemDirectoryHandle,
  ) {
    this.sourceId = sourceId;
    this.sourceDir = sourceDir;
  }

  static async open(
    sourceId: SourceId,
    rootProvider: OpfsRootProvider = defaultOpfsRoot,
  ): Promise<OpfsChunkedSpoolWriter> {
    const root = await rootProvider.getRoot();
    const spoolDir = await root.getDirectoryHandle(SPOOL_ROOT, { create: true });
    const sourceDir = await spoolDir.getDirectoryHandle(sourceId, { create: true });
    return new OpfsChunkedSpoolWriter(sourceId, sourceDir);
  }

  /** Override the next chunk-seq — used on resume to continue numbering. */
  setNextChunkSeq(seq: number): void {
    if (seq < 0 || !Number.isFinite(seq)) {
      throw new Error(`OpfsChunkedSpoolWriter: invalid chunk seq ${seq}`);
    }
    this.chunkSeq = seq;
  }

  async pushChunk(
    bytes: Uint8Array,
  ): Promise<{ chunkSeq: number; byteSize: number }> {
    if (bytes.byteLength === 0) {
      throw new Error('OpfsChunkedSpoolWriter: refusing to push an empty chunk');
    }
    const seq = this.chunkSeq++;
    const fh = await this.sourceDir.getFileHandle(`${seq}.bin`, { create: true });
    const writable = await fh.createWritable({ keepExistingData: false });
    await writable.write(bytes as Uint8Array<ArrayBuffer>);
    await writable.close();
    return { chunkSeq: seq, byteSize: bytes.byteLength };
  }

  async close(): Promise<void> {
    // Each chunk closes its own writable inside `pushChunk`. Method exists
    // for symmetry with `OpfsSingleSpoolWriter` and future buffered variants.
  }
}

/**
 * Best-effort cleanup. Used by `removeSource` in the coordinator. Silent on
 * "not found" — the spool may not exist for handle-based sources.
 *
 * With the unified per-source layout this is a single recursive
 * `removeEntry(sourceId)` regardless of writer mode.
 */
export const removeSpool = async (
  sourceId: SourceId,
  rootProvider: OpfsRootProvider = defaultOpfsRoot,
): Promise<void> => {
  const root = await rootProvider.getRoot();
  let spoolDir: FileSystemDirectoryHandle;
  try {
    spoolDir = await root.getDirectoryHandle(SPOOL_ROOT);
  } catch {
    return;
  }
  try {
    await spoolDir.removeEntry(sourceId, { recursive: true });
  } catch {
    /* nothing to remove */
  }
};
