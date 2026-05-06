import type { SourceId } from '../../../core/types/index.ts';
import {
  defaultOpfsRoot,
  type OpfsRootProvider,
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
export interface SourceBlobReader {
  read(filePath: string, byteStart: number, byteEnd: number): Promise<string>;
}

const resolveFileHandleByPath = async (
  root: FileSystemDirectoryHandle,
  filePath: string,
): Promise<FileSystemFileHandle> => {
  if (filePath === '') {
    throw new Error(
      "FsHandleReader: empty filePath against a directory handle — caller should pass the relative path.",
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
 * For a directory source the relative `file_path` is traversed at every read;
 * a `HandleCache` higher up usually pins resolved file handles.
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
    const fh =
      this.handle.kind === 'file'
        ? (this.handle as FileSystemFileHandle)
        : await resolveFileHandleByPath(
            this.handle as FileSystemDirectoryHandle,
            filePath,
          );
    const file = await fh.getFile();
    return file.slice(byteStart, byteEnd).text();
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
    return this.file.slice(byteStart, byteEnd).text();
  }
}

/**
 * Reader for sources whose data lives in a single OPFS spool file. Used for
 * `text` / `pasted` / `snapshot` / `url` sources — anything that arrives as a
 * single payload (or a small number of batched payloads written into the
 * same file).
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
    _filePath: string,
    byteStart: number,
    byteEnd: number,
  ): Promise<string> {
    const root = await this.rootProvider.getRoot();
    const spool = await root.getDirectoryHandle(SPOOL_ROOT);
    const fh = await spool.getFileHandle(`${this.sourceId}.bin`);
    const file = await fh.getFile();
    return file.slice(byteStart, byteEnd).text();
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
    return file.slice(byteStart, byteEnd).text();
  }
}
