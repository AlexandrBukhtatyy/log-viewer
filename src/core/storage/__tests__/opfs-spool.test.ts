import { describe, expect, it } from 'vitest';
import type { SourceId } from '../../types/index.ts';
import {
  OpfsChunkedSpoolWriter,
  OpfsSingleSpoolWriter,
  removeSpool,
  SINGLE_SPOOL_FILE,
  SPOOL_ROOT,
} from '../opfs-spool.ts';
import { createMockOpfsRoot } from './mock-opfs.ts';

const sid = (s: string): SourceId => s as SourceId;
const utf8 = new TextEncoder();

describe('OpfsSingleSpoolWriter', () => {
  it('returns absolute byte ranges that match cumulative writes', async () => {
    const provider = createMockOpfsRoot();
    const writer = await OpfsSingleSpoolWriter.open(sid('s1'), provider);
    const r1 = await writer.write(utf8.encode('hello'));
    const r2 = await writer.write(utf8.encode(' world'));
    expect(r1).toEqual({ byteStart: 0, byteEnd: 5 });
    expect(r2).toEqual({ byteStart: 5, byteEnd: 11 });
    await writer.close();

    // The spool file actually contains the concatenation we wrote.
    const spool = await (await provider.getRoot()).getDirectoryHandle(SPOOL_ROOT);
    const sourceDir = await spool.getDirectoryHandle('s1');
    const fh = await sourceDir.getFileHandle(SINGLE_SPOOL_FILE);
    const file = await fh.getFile();
    expect(await file.text()).toBe('hello world');
  });

  it('throws on write after close', async () => {
    const provider = createMockOpfsRoot();
    const writer = await OpfsSingleSpoolWriter.open(sid('s1'), provider);
    await writer.close();
    await expect(writer.write(utf8.encode('x'))).rejects.toThrow(/closed/);
  });

  it('write of zero bytes yields a zero-length range and does not advance', async () => {
    const provider = createMockOpfsRoot();
    const writer = await OpfsSingleSpoolWriter.open(sid('s1'), provider);
    await writer.write(utf8.encode('abc'));
    const r = await writer.write(new Uint8Array(0));
    expect(r).toEqual({ byteStart: 3, byteEnd: 3 });
    await writer.close();
  });
});

describe('OpfsChunkedSpoolWriter', () => {
  it('writes one file per pushChunk and increments seq', async () => {
    const provider = createMockOpfsRoot();
    const writer = await OpfsChunkedSpoolWriter.open(sid('s1'), provider);
    const c1 = await writer.pushChunk(utf8.encode('packet-A'));
    const c2 = await writer.pushChunk(utf8.encode('packet-B-larger'));
    expect(c1).toEqual({ chunkSeq: 0, byteSize: 8 });
    expect(c2).toEqual({ chunkSeq: 1, byteSize: 15 });

    const spool = await (await provider.getRoot()).getDirectoryHandle(SPOOL_ROOT);
    const sourceDir = await spool.getDirectoryHandle('s1');
    const f0 = await (await sourceDir.getFileHandle('0.bin')).getFile();
    const f1 = await (await sourceDir.getFileHandle('1.bin')).getFile();
    expect(await f0.text()).toBe('packet-A');
    expect(await f1.text()).toBe('packet-B-larger');
  });

  it('refuses empty chunks', async () => {
    const provider = createMockOpfsRoot();
    const writer = await OpfsChunkedSpoolWriter.open(sid('s1'), provider);
    await expect(writer.pushChunk(new Uint8Array(0))).rejects.toThrow(/empty chunk/);
  });

  it('setNextChunkSeq lets resumed writers continue numbering', async () => {
    const provider = createMockOpfsRoot();
    const writer = await OpfsChunkedSpoolWriter.open(sid('s1'), provider);
    writer.setNextChunkSeq(7);
    const c = await writer.pushChunk(utf8.encode('x'));
    expect(c.chunkSeq).toBe(7);
  });
});

describe('removeSpool', () => {
  it('removes a single-spool source dir when present', async () => {
    const provider = createMockOpfsRoot();
    const writer = await OpfsSingleSpoolWriter.open(sid('s1'), provider);
    await writer.write(utf8.encode('x'));
    await writer.close();

    await removeSpool(sid('s1'), provider);
    const spool = await (await provider.getRoot()).getDirectoryHandle(SPOOL_ROOT);
    await expect(spool.getDirectoryHandle('s1')).rejects.toThrow();
  });

  it('removes a chunked-spool directory recursively', async () => {
    const provider = createMockOpfsRoot();
    const writer = await OpfsChunkedSpoolWriter.open(sid('s1'), provider);
    await writer.pushChunk(utf8.encode('a'));
    await writer.pushChunk(utf8.encode('b'));

    await removeSpool(sid('s1'), provider);
    const spool = await (await provider.getRoot()).getDirectoryHandle(SPOOL_ROOT);
    await expect(spool.getDirectoryHandle('s1')).rejects.toThrow();
  });

  it('is a no-op when nothing exists', async () => {
    const provider = createMockOpfsRoot();
    await expect(removeSpool(sid('absent'), provider)).resolves.toBeUndefined();
  });
});
