import { gunzipSync, unzipSync } from 'fflate';
import type { LogSource, SnapshotLogSource } from '../types/log-source.ts';
import {
  flattenArchiveMemberName,
  writeSpoolFile,
} from '../storage/opfs-spool.ts';
import type {
  LogLineFrame,
  LogSourceAdapter,
  LogSourceAdapterFactory,
} from './source-adapter.ts';

const isSnapshotSource = (s: LogSource): s is SnapshotLogSource =>
  s.kind === 'snapshot';

const TEXT_EXT_RE =
  /\.(log|txt|json|jsonl|ndjson|out|err|yaml|yml|conf|csv|tsv)$/i;

const isLikelyTextFile = (path: string): boolean => {
  // Skip directory entries and dotfiles like __MACOSX/.DS_Store noise.
  if (path.endsWith('/')) return false;
  const base = path.split('/').pop() ?? path;
  if (base.startsWith('.')) return false;
  if (base.startsWith('._')) return false; // macOS resource forks
  if (path.startsWith('__MACOSX/')) return false;
  return TEXT_EXT_RE.test(base);
};

interface ExtractedFile {
  readonly name: string;
  readonly bytes: Uint8Array;
}

/**
 * Detect archive format by magic bytes, falling back to filename when ambiguous.
 *
 * - `0x50 0x4B` → zip (`PK\x03\x04`).
 * - `0x1F 0x8B` → gzip; treated as `tar.gz` (single-file gzip is uncommon in
 *   log workflows and would yield one entry called after the archive itself
 *   minus `.gz`).
 * - otherwise → plain tar if the filename ends in `.tar`.
 */
const detectFormat = (
  bytes: Uint8Array,
  filename: string,
): 'zip' | 'tar' | 'tar.gz' | 'unknown' => {
  if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) return 'zip';
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b)
    return 'tar.gz';
  const lower = filename.toLowerCase();
  if (lower.endsWith('.tar')) return 'tar';
  if (lower.endsWith('.zip')) return 'zip';
  if (lower.endsWith('.tgz') || lower.endsWith('.tar.gz')) return 'tar.gz';
  return 'unknown';
};

/**
 * Minimal POSIX-tar reader. Handles regular files (typeflag '0' / '\0') and
 * skips long-name PAX/GNU extensions — names longer than 100 bytes appear as
 * truncated. Adequate for typical k8s/docker log dumps; replace with a real
 * tar lib if pax extensions show up in real fixtures.
 */
const readTar = (data: Uint8Array): ExtractedFile[] => {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const out: ExtractedFile[] = [];
  let offset = 0;

  const isAllZero = (slice: Uint8Array): boolean => {
    for (let i = 0; i < slice.length; i++) if (slice[i] !== 0) return false;
    return true;
  };

  const readNullTerminated = (slice: Uint8Array): string => {
    const nul = slice.indexOf(0);
    return decoder.decode(nul === -1 ? slice : slice.subarray(0, nul));
  };

  while (offset + 512 <= data.length) {
    const header = data.subarray(offset, offset + 512);
    if (isAllZero(header)) break;
    const name = readNullTerminated(header.subarray(0, 100));
    const sizeStr = readNullTerminated(header.subarray(124, 136)).trim();
    const size = parseInt(sizeStr, 8);
    const typeflag = String.fromCharCode(header[156] ?? 0);
    offset += 512;
    if (
      Number.isFinite(size) &&
      size > 0 &&
      (typeflag === '0' || typeflag === '\0')
    ) {
      out.push({ name, bytes: data.subarray(offset, offset + size) });
    }
    if (Number.isFinite(size) && size > 0) {
      offset += Math.ceil(size / 512) * 512;
    }
  }
  return out;
};

const extractZip = (bytes: Uint8Array): ExtractedFile[] => {
  const entries = unzipSync(bytes);
  return Object.entries(entries).map(([name, data]) => ({ name, bytes: data }));
};

const extractTarGz = (bytes: Uint8Array): ExtractedFile[] =>
  readTar(gunzipSync(bytes));

const extractTar = (bytes: Uint8Array): ExtractedFile[] => readTar(bytes);

export const createSnapshotAdapter: LogSourceAdapterFactory = (source) => {
  if (!isSnapshotSource(source)) {
    throw new Error(
      `createSnapshotAdapter: expected source.kind='snapshot', got '${source.kind}'`,
    );
  }

  const adapter: LogSourceAdapter = {
    source,
    open: async (signal) => {
      // Read the whole archive into memory once; in-browser archives that
      // wouldn't fit usually wouldn't fit the OPFS index either.
      const buffer = new Uint8Array(await source.archive.arrayBuffer());
      if (signal.aborted) throw new DOMException('aborted', 'AbortError');

      const fmt = detectFormat(buffer, source.archive.name);
      let files: ExtractedFile[];
      switch (fmt) {
        case 'zip':
          files = extractZip(buffer);
          break;
        case 'tar.gz':
          files = extractTarGz(buffer);
          break;
        case 'tar':
          files = extractTar(buffer);
          break;
        default:
          throw new Error(
            `snapshot: unsupported archive format for '${source.archive.name}' — expected .zip / .tar / .tar.gz / .tgz`,
          );
      }

      const textFiles = files.filter((f) => isLikelyTextFile(f.name));
      if (textFiles.length === 0) {
        throw new Error(
          `snapshot: no readable text files in '${source.archive.name}' (looked for .log .txt .json .jsonl .ndjson .out .err .yaml .yml .conf .csv .tsv)`,
        );
      }

      const decoder = new TextDecoder('utf-8', { fatal: false });
      // Each archive member is spooled as its own file under
      // `lv-spool/<sourceId>/<flat-name>.bin` so the lazy-resolver can
      // slice it back at read time. Frames carry the original member
      // name (with `/`) — `OpfsArchiveSpoolReader` un-flattens it
      // transparently. Offsets are relative to the member, not the
      // archive.
      return new ReadableStream<LogLineFrame>({
        async start(controller) {
          try {
            for (const f of textFiles) {
              if (signal.aborted) {
                controller.error(new DOMException('aborted', 'AbortError'));
                return;
              }
              try {
                await writeSpoolFile(
                  source.id,
                  flattenArchiveMemberName(f.name),
                  f.bytes,
                );
              } catch (err) {
                console.warn(
                  `[snapshot-adapter] OPFS spool write failed for '${f.name}':`,
                  err instanceof Error ? err.message : err,
                );
              }
              const bytes = f.bytes;
              let lineStart = 0;
              let lineNo = 0;
              for (let i = 0; i < bytes.byteLength; i++) {
                if (bytes[i] !== 0x0a) continue;
                let lineEnd = i;
                if (lineEnd > lineStart && bytes[lineEnd - 1] === 0x0d)
                  lineEnd -= 1;
                lineNo += 1;
                controller.enqueue({
                  path: f.name,
                  line: decoder.decode(bytes.subarray(lineStart, lineEnd)),
                  byteStart: lineStart,
                  byteEnd: lineEnd,
                  lineNumber: lineNo,
                });
                lineStart = i + 1;
              }
              if (lineStart < bytes.byteLength) {
                let lineEnd = bytes.byteLength;
                if (bytes[lineEnd - 1] === 0x0d) lineEnd -= 1;
                if (lineEnd > lineStart) {
                  lineNo += 1;
                  controller.enqueue({
                    path: f.name,
                    line: decoder.decode(bytes.subarray(lineStart, lineEnd)),
                    byteStart: lineStart,
                    byteEnd: lineEnd,
                    lineNumber: lineNo,
                  });
                }
              }
            }
            controller.close();
          } catch (err) {
            controller.error(err);
          }
        },
      });
    },
    close: async () => {
      /* in-memory; nothing to release */
    },
  };

  return adapter;
};
