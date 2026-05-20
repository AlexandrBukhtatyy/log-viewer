import { describe, expect, it } from 'vitest';
import type { SourceId } from '../../types/index.ts';
import {
  OpfsChunkedSpoolWriter,
  OpfsSingleSpoolWriter,
  SPOOL_ROOT,
} from '../opfs-spool.ts';
import {
  FileSourceReader,
  FsHandleReader,
  MAX_SUPERCHUNK_BYTES,
  OpfsChunkedSpoolReader,
  OpfsSingleSpoolReader,
  readRangesFromBlob,
} from '../source-blob-reader.ts';
import { createMockOpfsRoot } from './mock-opfs.ts';

const sid = (s: string): SourceId => s as SourceId;
const utf8 = new TextEncoder();

const writeFile = async (
  parent: FileSystemDirectoryHandle,
  name: string,
  text: string,
): Promise<void> => {
  const fh = await parent.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(utf8.encode(text));
  await w.close();
};

describe('FsHandleReader', () => {
  it('resolves a file inside a directory by relative path', async () => {
    const { rawRoot } = createMockOpfsRoot();
    const root = rawRoot as unknown as FileSystemDirectoryHandle;
    const sub = await root.getDirectoryHandle('sub', { create: true });
    await writeFile(sub, 'a.log', 'hello world');

    const reader = new FsHandleReader(root);
    const text = await reader.read('sub/a.log', 0, 5);
    expect(text).toBe('hello');
  });

  it('walks nested sub-directories', async () => {
    const { rawRoot } = createMockOpfsRoot();
    const root = rawRoot as unknown as FileSystemDirectoryHandle;
    const a = await root.getDirectoryHandle('a', { create: true });
    const b = await a.getDirectoryHandle('b', { create: true });
    await writeFile(b, 'c.log', 'nested-content');

    const reader = new FsHandleReader(root);
    expect(await reader.read('a/b/c.log', 7, 14)).toBe('content');
  });

  it('reads a single-file handle without a relative path', async () => {
    const { rawRoot } = createMockOpfsRoot();
    const root = rawRoot as unknown as FileSystemDirectoryHandle;
    await writeFile(root, 'one.log', 'standalone');
    const fh = await root.getFileHandle('one.log');

    const reader = new FsHandleReader(fh);
    expect(await reader.read('', 0, 4)).toBe('stan');
  });

  it('rejects empty path against a directory handle', async () => {
    const { rawRoot } = createMockOpfsRoot();
    const reader = new FsHandleReader(
      rawRoot as unknown as FileSystemDirectoryHandle,
    );
    await expect(reader.read('', 0, 1)).rejects.toThrow(/empty filePath/);
  });
});

describe('OpfsSingleSpoolReader', () => {
  it('slices the spool file by absolute byte range', async () => {
    const provider = createMockOpfsRoot();
    const writer = await OpfsSingleSpoolWriter.open(sid('s1'), provider);
    await writer.write(utf8.encode('one\ntwo\nthree'));
    await writer.close();

    const reader = new OpfsSingleSpoolReader(sid('s1'), provider);
    expect(await reader.read('', 0, 3)).toBe('one');
    expect(await reader.read('', 4, 7)).toBe('two');
    expect(await reader.read('', 8, 13)).toBe('three');
  });
});

describe('OpfsChunkedSpoolReader', () => {
  it('resolves chunkSeq path and slices chunk-locally', async () => {
    const provider = createMockOpfsRoot();
    const writer = await OpfsChunkedSpoolWriter.open(sid('s1'), provider);
    await writer.pushChunk(utf8.encode('AAAA'));
    await writer.pushChunk(utf8.encode('BBBBBB'));

    const reader = new OpfsChunkedSpoolReader(sid('s1'), provider);
    // Each chunk is its own file — offsets are local to the chunk.
    expect(await reader.read('0', 0, 4)).toBe('AAAA');
    expect(await reader.read('1', 2, 5)).toBe('BBB');
  });

  it('rejects malformed chunk paths', async () => {
    const provider = createMockOpfsRoot();
    const reader = new OpfsChunkedSpoolReader(sid('s1'), provider);
    await expect(reader.read('not-a-number', 0, 1)).rejects.toThrow(
      /invalid chunk path/,
    );
  });

  it('caller stores absolute chunked layout in the same lv-spool root', async () => {
    const provider = createMockOpfsRoot();
    const writer = await OpfsChunkedSpoolWriter.open(sid('zzz'), provider);
    await writer.pushChunk(utf8.encode('hello'));
    const root = await provider.getRoot();
    const spool = await root.getDirectoryHandle(SPOOL_ROOT);
    const sourceDir = await spool.getDirectoryHandle('zzz');
    const fh = await sourceDir.getFileHandle('0.bin');
    const file = await fh.getFile();
    expect(await file.text()).toBe('hello');
  });
});

describe('readRangesFromBlob (batch nibbler)', () => {
  const makeBlob = (text: string): Blob =>
    new Blob([utf8.encode(text)], { type: 'application/octet-stream' });

  it('returns [] for zero ranges without touching the blob', async () => {
    const blob = makeBlob('does not matter');
    expect(await readRangesFromBlob(blob, [])).toEqual([]);
  });

  it('reads multiple ranges from one super-chunk in input order', async () => {
    const blob = makeBlob('one\ntwo\nthree\nfour');
    const ranges = [
      { byteStart: 0, byteEnd: 3 }, // one
      { byteStart: 4, byteEnd: 7 }, // two
      { byteStart: 8, byteEnd: 13 }, // three
      { byteStart: 14, byteEnd: 18 }, // four
    ];
    const out = await readRangesFromBlob(blob, ranges);
    expect(out).toEqual(['one', 'two', 'three', 'four']);
  });

  it('preserves input order when ranges are not sorted', async () => {
    const blob = makeBlob('AAAA-BBBB-CCCC');
    const ranges = [
      { byteStart: 10, byteEnd: 14 }, // CCCC
      { byteStart: 0, byteEnd: 4 }, // AAAA
      { byteStart: 5, byteEnd: 9 }, // BBBB
    ];
    expect(await readRangesFromBlob(blob, ranges)).toEqual([
      'CCCC',
      'AAAA',
      'BBBB',
    ]);
  });

  it('decodes UTF-8 multibyte ranges correctly (no String.slice corruption)', async () => {
    // Russian + emoji to force multibyte UTF-8.
    const parts = ['Привет', 'мир', '👋'];
    const text = parts.join('\n');
    const blob = makeBlob(text);
    const bytes = utf8.encode(text);
    const ranges: { byteStart: number; byteEnd: number }[] = [];
    let cursor = 0;
    for (const p of parts) {
      const len = utf8.encode(p).length;
      ranges.push({ byteStart: cursor, byteEnd: cursor + len });
      cursor += len + 1; // skip the '\n'
    }
    expect(bytes.length).toBeGreaterThan(text.length); // multibyte present
    expect(await readRangesFromBlob(blob, ranges)).toEqual(parts);
  });

  it('falls back to a dedicated read when a single range exceeds the cap', async () => {
    const bytes = new Uint8Array(MAX_SUPERCHUNK_BYTES + 100).fill(0x41); // 'A'
    const blob = new Blob([bytes]);
    const ranges = [{ byteStart: 0, byteEnd: bytes.length }];
    const [out] = await readRangesFromBlob(blob, ranges);
    expect(out!.length).toBe(bytes.length);
    expect(out!.startsWith('AAAA')).toBe(true);
  });

  it('splits into sub-chunks when packed ranges exceed the cap', async () => {
    // Two large ranges that, taken together, exceed the cap but fit
    // individually. The function should split them into two reads.
    const half = MAX_SUPERCHUNK_BYTES - 1024;
    const a = new Uint8Array(half).fill(0x41);
    const b = new Uint8Array(half).fill(0x42);
    const gap = new Uint8Array(1024).fill(0);
    const blob = new Blob([a, gap, b]);
    const ranges = [
      { byteStart: 0, byteEnd: half },
      { byteStart: half + 1024, byteEnd: half + 1024 + half },
    ];
    const out = await readRangesFromBlob(blob, ranges);
    expect(out[0]!.length).toBe(half);
    expect(out[1]!.length).toBe(half);
    expect(out[0]!.charCodeAt(0)).toBe(0x41);
    expect(out[1]!.charCodeAt(0)).toBe(0x42);
  });
});

describe('FileSourceReader.readBatch', () => {
  it('batch-reads ranges from a File', async () => {
    const file = new File([utf8.encode('one\ntwo\nthree')], 'log.txt');
    const reader = new FileSourceReader(file);
    const out = await reader.readBatch('', [
      { byteStart: 0, byteEnd: 3 },
      { byteStart: 4, byteEnd: 7 },
      { byteStart: 8, byteEnd: 13 },
    ]);
    expect(out).toEqual(['one', 'two', 'three']);
  });

  it('returns [] for an empty range list', async () => {
    const file = new File([utf8.encode('hello')], 'log.txt');
    const reader = new FileSourceReader(file);
    expect(await reader.readBatch('', [])).toEqual([]);
  });
});

describe('FsHandleReader.readBatch', () => {
  it('walks the directory tree once for many ranges in the same file', async () => {
    const { rawRoot } = createMockOpfsRoot();
    const root = rawRoot as unknown as FileSystemDirectoryHandle;
    const sub = await root.getDirectoryHandle('sub', { create: true });
    await writeFile(sub, 'a.log', 'one\ntwo\nthree');

    const reader = new FsHandleReader(root);
    const out = await reader.readBatch('sub/a.log', [
      { byteStart: 0, byteEnd: 3 },
      { byteStart: 8, byteEnd: 13 },
    ]);
    expect(out).toEqual(['one', 'three']);
  });
});

describe('OpfsSingleSpoolReader.readBatch', () => {
  it('batches multiple ranges from the single spool file', async () => {
    const provider = createMockOpfsRoot();
    const writer = await OpfsSingleSpoolWriter.open(sid('s1'), provider);
    await writer.write(utf8.encode('one\ntwo\nthree'));
    await writer.close();

    const reader = new OpfsSingleSpoolReader(sid('s1'), provider);
    expect(
      await reader.readBatch('', [
        { byteStart: 0, byteEnd: 3 },
        { byteStart: 4, byteEnd: 7 },
        { byteStart: 8, byteEnd: 13 },
      ]),
    ).toEqual(['one', 'two', 'three']);
  });
});
