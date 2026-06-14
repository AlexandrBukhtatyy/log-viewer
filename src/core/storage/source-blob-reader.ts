import type { SourceId } from '../types/index.ts';
import {
  defaultOpfsRoot,
  flattenArchiveMemberName,
  type OpfsRootProvider,
  SINGLE_SPOOL_FILE,
  SPOOL_ROOT,
} from './opfs-spool.ts';

/**
 * Read-side counterpart to the storage abstraction. Indexer rows hold
 * `(file_path, byte_start, byte_end)` pointers; `SourceBlobReader.read`
 * resolves them back to a string by slicing the underlying `Blob`.
 *
 * `file_path` semantics (must match what the adapter emitted into the index):
 * - directory:    relative path inside the source-handle (`sub/a.log`)
 * - file:         empty string `''` (handle is the file itself)
 * - opfs-single:  empty string `''` (`lv-spool/<sourceId>.bin`)
 * - opfs-chunked: chunk-seq stringified (`'0'`, `'1'`, …) →
 *                 `lv-spool/<sourceId>/<seq>.bin`; offsets are inside the
 *                 chunk file, not absolute across the whole stream.
 */
export interface ByteRange {
  readonly byteStart: number;
  readonly byteEnd: number;
}

export interface SourceBlobReader {
  read(filePath: string, byteStart: number, byteEnd: number): Promise<string>;
  /**
   * Read N byte-ranges from a single file in as few IO operations as
   * possible. Result is index-parallel to `ranges` — `output[i]` is the
   * decoded text of `ranges[i]`. Ranges must come from the same `filePath`;
   * the caller is responsible for grouping pointers by `(sourceId, filePath)`.
   *
   * Empty `ranges` returns an empty array without opening the file.
   */
  readBatch(
    filePath: string,
    ranges: ReadonlyArray<ByteRange>,
  ): Promise<ReadonlyArray<string>>;
}

/**
 * Upper bound on how many bytes we pull in a single super-chunk before
 * splitting into sub-chunks. In practice a 500-row window of pointer
 * entries spans ~100 KB of source bytes, so this cap is purely defensive
 * against pathological inputs (multi-MB lines, snapshot members spanning
 * gigabytes). Exported for tests.
 */
export const MAX_SUPERCHUNK_BYTES = 4 * 1024 * 1024;

const utf8Decoder = new TextDecoder('utf-8', { fatal: false });

/**
 * Read N byte-ranges from a single `Blob` in as few `arrayBuffer()` calls
 * as possible. Strategy:
 *   1. Sort the ranges by `byteStart` (preserving the original index so we
 *      can re-emit results in input order).
 *   2. Greedily pack consecutive ranges into a single super-chunk while the
 *      span stays under `MAX_SUPERCHUNK_BYTES`. Each super-chunk becomes
 *      one `blob.slice(min, max).arrayBuffer()` call and one byte-level
 *      `TextDecoder` walk over its substrings — N reads collapse to 1.
 *   3. Ranges whose individual length exceeds the cap fall back to a
 *      dedicated single-range read so we never balloon a super-chunk.
 *
 * UTF-8 correctness: decoding goes through `TextDecoder.decode(subarray)`
 * over byte offsets, never `String.slice`. The indexer's `byte_start` /
 * `byte_end` are byte positions; string-codeunit slicing would corrupt
 * multibyte characters at chunk boundaries.
 */
export const readRangesFromBlob = async (
  blob: Blob,
  ranges: ReadonlyArray<ByteRange>,
): Promise<string[]> => {
  if (ranges.length === 0) return [];
  const out = new Array<string>(ranges.length);
  const indexed = ranges.map((r, i) => ({ r, i }));
  indexed.sort((a, b) => a.r.byteStart - b.r.byteStart);

  let cursor = 0;
  while (cursor < indexed.length) {
    const first = indexed[cursor]!;
    const firstLen = first.r.byteEnd - first.r.byteStart;
    // Single range exceeds the cap — read it on its own to avoid super-chunks
    // larger than MAX_SUPERCHUNK_BYTES.
    if (firstLen > MAX_SUPERCHUNK_BYTES) {
      const buf = await blob
        .slice(first.r.byteStart, first.r.byteEnd)
        .arrayBuffer();
      out[first.i] = utf8Decoder.decode(new Uint8Array(buf));
      cursor += 1;
      continue;
    }

    const min = first.r.byteStart;
    let max = first.r.byteEnd;
    let end = cursor + 1;
    while (end < indexed.length) {
      const next = indexed[end]!;
      const candidateMax = Math.max(max, next.r.byteEnd);
      if (candidateMax - min > MAX_SUPERCHUNK_BYTES) break;
      max = candidateMax;
      end += 1;
    }

    const buf = await blob.slice(min, max).arrayBuffer();
    const view = new Uint8Array(buf);
    for (let k = cursor; k < end; k++) {
      const item = indexed[k]!;
      const localStart = item.r.byteStart - min;
      const localEnd = item.r.byteEnd - min;
      out[item.i] = utf8Decoder.decode(view.subarray(localStart, localEnd));
    }
    cursor = end;
  }

  return out;
};

/**
 * Shared `read(...)` implementation for any reader whose `readBatch` is
 * already fast — keeps every concrete class a one-liner without
 * sacrificing UTF-8 correctness.
 */
const readOneViaBatch = async (
  reader: SourceBlobReader,
  filePath: string,
  byteStart: number,
  byteEnd: number,
): Promise<string> => {
  const [text] = await reader.readBatch(filePath, [{ byteStart, byteEnd }]);
  return text ?? '';
};

const resolveFileHandleByPath = async (
  root: FileSystemDirectoryHandle,
  filePath: string,
): Promise<FileSystemFileHandle> => {
  if (filePath === '') {
    throw new Error(
      'FsHandleReader: empty filePath against a directory handle — caller should pass the relative path.',
    );
  }
  const segments = filePath.split('/').filter((s) => s.length > 0);
  let cursor: FileSystemDirectoryHandle = root;
  for (let i = 0; i < segments.length - 1; i++) {
    cursor = await cursor.getDirectoryHandle(segments[i]!);
  }
  return cursor.getFileHandle(segments[segments.length - 1]!);
};

/**
 * Reader for sources backed by a user-picked FS handle (directory or file).
 * For a directory source the relative `file_path` is traversed once per
 * `readBatch` call (not per range), so N byte-ranges in the same file pay
 * the directory walk exactly once.
 */
export class FsHandleReader implements SourceBlobReader {
  private readonly handle: FileSystemDirectoryHandle | FileSystemFileHandle;
  constructor(handle: FileSystemDirectoryHandle | FileSystemFileHandle) {
    this.handle = handle;
  }

  async read(
    filePath: string,
    byteStart: number,
    byteEnd: number,
  ): Promise<string> {
    return readOneViaBatch(this, filePath, byteStart, byteEnd);
  }

  async readBatch(
    filePath: string,
    ranges: ReadonlyArray<ByteRange>,
  ): Promise<ReadonlyArray<string>> {
    if (ranges.length === 0) return [];
    const fh =
      this.handle.kind === 'file'
        ? (this.handle as FileSystemFileHandle)
        : await resolveFileHandleByPath(
            this.handle as FileSystemDirectoryHandle,
            filePath,
          );
    const file = await fh.getFile();
    return readRangesFromBlob(file, ranges);
  }
}

/**
 * Reader for sources whose body is an in-memory `File` object — `file`
 * (user picked a single log file) and `snapshot` (the archive itself,
 * sliced once per archive member by the archive's own offset table). The
 * adapter's emitted `byte_start`/`byte_end` are absolute offsets inside
 * the same `File`, so this reader just slices it directly.
 */
export class FileSourceReader implements SourceBlobReader {
  private readonly file: File;
  constructor(file: File) {
    this.file = file;
  }

  async read(
    _filePath: string,
    byteStart: number,
    byteEnd: number,
  ): Promise<string> {
    return readOneViaBatch(this, '', byteStart, byteEnd);
  }

  async readBatch(
    _filePath: string,
    ranges: ReadonlyArray<ByteRange>,
  ): Promise<ReadonlyArray<string>> {
    return readRangesFromBlob(this.file, ranges);
  }
}

/**
 * Reader for sources whose data lives in a single OPFS spool file. Used for
 * `text` / `pasted` / `snapshot` / `url` sources — anything that arrives as a
 * single payload (or a small number of batched payloads written into the
 * same file). The OPFS directory walk (`lv-spool/<sourceId>/<file>`) runs
 * exactly once per `readBatch` regardless of how many ranges are requested.
 */
export class OpfsSingleSpoolReader implements SourceBlobReader {
  private readonly sourceId: SourceId;
  private readonly rootProvider: OpfsRootProvider;
  constructor(
    sourceId: SourceId,
    rootProvider: OpfsRootProvider = defaultOpfsRoot,
  ) {
    this.sourceId = sourceId;
    this.rootProvider = rootProvider;
  }

  async read(
    filePath: string,
    byteStart: number,
    byteEnd: number,
  ): Promise<string> {
    return readOneViaBatch(this, filePath, byteStart, byteEnd);
  }

  async readBatch(
    _filePath: string,
    ranges: ReadonlyArray<ByteRange>,
  ): Promise<ReadonlyArray<string>> {
    if (ranges.length === 0) return [];
    const root = await this.rootProvider.getRoot();
    const spool = await root.getDirectoryHandle(SPOOL_ROOT);
    const sourceDir = await spool.getDirectoryHandle(this.sourceId);
    const fh = await sourceDir.getFileHandle(SINGLE_SPOOL_FILE);
    const file = await fh.getFile();
    return readRangesFromBlob(file, ranges);
  }
}

/**
 * Reader for snapshot-archive members. The adapter wrote each archive
 * member as its own file under `lv-spool/<sourceId>/`, with `/` collapsed
 * into `__` (see `flattenArchiveMemberName`). Frames carry the original
 * member name so the sidebar / `entry.filePath` stay readable; the
 * reader does the un-flatten transparently.
 */
export class OpfsArchiveSpoolReader implements SourceBlobReader {
  private readonly sourceId: SourceId;
  private readonly rootProvider: OpfsRootProvider;
  constructor(
    sourceId: SourceId,
    rootProvider: OpfsRootProvider = defaultOpfsRoot,
  ) {
    this.sourceId = sourceId;
    this.rootProvider = rootProvider;
  }

  async read(
    memberPath: string,
    byteStart: number,
    byteEnd: number,
  ): Promise<string> {
    return readOneViaBatch(this, memberPath, byteStart, byteEnd);
  }

  async readBatch(
    memberPath: string,
    ranges: ReadonlyArray<ByteRange>,
  ): Promise<ReadonlyArray<string>> {
    if (ranges.length === 0) return [];
    if (memberPath === '') {
      throw new Error(
        'OpfsArchiveSpoolReader: empty memberPath — snapshot frames always carry a name.',
      );
    }
    const fileName = flattenArchiveMemberName(memberPath);
    const root = await this.rootProvider.getRoot();
    const spool = await root.getDirectoryHandle(SPOOL_ROOT);
    const sourceDir = await spool.getDirectoryHandle(this.sourceId);
    const fh = await sourceDir.getFileHandle(fileName);
    const file = await fh.getFile();
    return readRangesFromBlob(file, ranges);
  }
}

/**
 * Reader for chunk-per-packet OPFS layouts (stream sources). `filePath` is
 * the chunk-seq stringified — the reader resolves it to
 * `lv-spool/<sourceId>/<seq>.bin` and slices inside that single chunk file.
 * Offsets are *chunk-local*, never global across the whole stream.
 */
export class OpfsChunkedSpoolReader implements SourceBlobReader {
  private readonly sourceId: SourceId;
  private readonly rootProvider: OpfsRootProvider;
  constructor(
    sourceId: SourceId,
    rootProvider: OpfsRootProvider = defaultOpfsRoot,
  ) {
    this.sourceId = sourceId;
    this.rootProvider = rootProvider;
  }

  async read(
    chunkSeqPath: string,
    byteStart: number,
    byteEnd: number,
  ): Promise<string> {
    return readOneViaBatch(this, chunkSeqPath, byteStart, byteEnd);
  }

  async readBatch(
    chunkSeqPath: string,
    ranges: ReadonlyArray<ByteRange>,
  ): Promise<ReadonlyArray<string>> {
    if (ranges.length === 0) return [];
    const seq = Number(chunkSeqPath);
    if (!Number.isInteger(seq) || seq < 0) {
      throw new Error(
        `OpfsChunkedSpoolReader: invalid chunk path '${chunkSeqPath}' for source '${this.sourceId}'`,
      );
    }
    const root = await this.rootProvider.getRoot();
    const spool = await root.getDirectoryHandle(SPOOL_ROOT);
    const sourceDir = await spool.getDirectoryHandle(this.sourceId);
    const fh = await sourceDir.getFileHandle(`${seq}.bin`);
    const file = await fh.getFile();
    return readRangesFromBlob(file, ranges);
  }
}
