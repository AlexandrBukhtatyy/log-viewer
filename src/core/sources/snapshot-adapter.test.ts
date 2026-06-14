import { gzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import type { LogSource, SourceId } from '../types/index.ts';
import { createSnapshotAdapter } from './snapshot-adapter.ts';

const sid = (s: string) => s as SourceId;

const makeSource = (file: File): Extract<LogSource, { kind: 'snapshot' }> => ({
  kind: 'snapshot',
  id: sid('s-snap-1'),
  name: file.name,
  archive: file,
});

const collect = async (
  source: Extract<LogSource, { kind: 'snapshot' }>,
): Promise<string[]> => {
  const adapter = createSnapshotAdapter(source);
  const ctrl = new AbortController();
  const stream = await adapter.open(ctrl.signal);
  const reader = stream.getReader();
  const lines: string[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    lines.push(value.line);
  }
  await adapter.close();
  return lines;
};

const enc = new TextEncoder();

const mkFile = (data: Uint8Array, name: string): File =>
  new File([data as unknown as BlobPart], name);

const buildTar = (files: Record<string, Uint8Array>): Uint8Array => {
  const blocks: Uint8Array[] = [];
  for (const [name, data] of Object.entries(files)) {
    const header = new Uint8Array(512);
    header.set(enc.encode(name).subarray(0, 100), 0);
    const sizeOctal = data.length.toString(8).padStart(11, '0') + '\0';
    header.set(enc.encode(sizeOctal), 124);
    header[156] = '0'.charCodeAt(0);
    blocks.push(header);
    blocks.push(data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad > 0) blocks.push(new Uint8Array(pad));
  }
  blocks.push(new Uint8Array(512));
  blocks.push(new Uint8Array(512));
  // concat
  const total = blocks.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const b of blocks) {
    out.set(b, off);
    off += b.length;
  }
  return out;
};

describe('createSnapshotAdapter', () => {
  it('extracts log files from a zip archive', async () => {
    const zip = zipSync({
      'app.log': enc.encode('a\nb\nc\n'),
      'errors.log': enc.encode('boom\n'),
    });
    const file = mkFile(zip, 'snapshot.zip');
    expect(await collect(makeSource(file))).toEqual(['a', 'b', 'c', 'boom']);
  });

  it('skips binaries and macOS resource forks (whitelist by extension)', async () => {
    const zip = zipSync({
      'app.log': enc.encode('hello\n'),
      'image.bin': new Uint8Array([0, 1, 2, 3]),
      '__MACOSX/._app.log': enc.encode('garbage'),
      '.DS_Store': new Uint8Array([0]),
    });
    const file = mkFile(zip, 'mixed.zip');
    expect(await collect(makeSource(file))).toEqual(['hello']);
  });

  it('extracts files from an uncompressed tar', async () => {
    const tar = buildTar({
      'one.log': enc.encode('alpha\n'),
      'nested/two.txt': enc.encode('beta\n'),
    });
    const file = mkFile(tar, 'snap.tar');
    expect(await collect(makeSource(file))).toEqual(['alpha', 'beta']);
  });

  it('extracts files from a gzipped tar (.tar.gz)', async () => {
    const tar = buildTar({ 'svc.log': enc.encode('one\ntwo\n') });
    const gz = gzipSync(tar);
    const file = mkFile(gz, 'snap.tar.gz');
    expect(await collect(makeSource(file))).toEqual(['one', 'two']);
  });

  it('throws for unknown archive formats', async () => {
    // Random non-archive bytes, name without zip/tar extension.
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const file = mkFile(bytes, 'mystery.bin');
    await expect(collect(makeSource(file))).rejects.toThrow(
      /unsupported archive format/,
    );
  });

  it('throws if archive has no readable text files', async () => {
    const zip = zipSync({ 'image.png': new Uint8Array([0, 1, 2]) });
    const file = mkFile(zip, 'binaries.zip');
    await expect(collect(makeSource(file))).rejects.toThrow(
      /no readable text files/,
    );
  });

  it('appends a trailing newline so adjacent files do not run together', async () => {
    const zip = zipSync({
      'a.log': enc.encode('one'), // no trailing \n
      'b.log': enc.encode('two\n'),
    });
    const file = mkFile(zip, 'two.zip');
    expect(await collect(makeSource(file))).toEqual(['one', 'two']);
  });

  it('rejects non-snapshot sources at construction', () => {
    const fakeSource = {
      kind: 'file',
      id: sid('s'),
      name: 'x',
      size: 0,
    } as unknown as LogSource;
    expect(() => createSnapshotAdapter(fakeSource)).toThrow(
      /expected source.kind='snapshot'/,
    );
  });
});
