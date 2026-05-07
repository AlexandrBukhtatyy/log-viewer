import { describe, expect, it } from 'vitest';
import type { SourceId } from '../../types/index.ts';
import {
  OpfsChunkedSpoolWriter,
  OpfsSingleSpoolWriter,
  SPOOL_ROOT,
} from '../opfs-spool.ts';
import {
  FsHandleReader,
  OpfsChunkedSpoolReader,
  OpfsSingleSpoolReader,
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
