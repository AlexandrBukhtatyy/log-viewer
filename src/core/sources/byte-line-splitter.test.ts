import { describe, expect, it } from 'vitest';
import { createByteLineSplitter } from './byte-line-splitter.ts';
import type { LogLineFrame } from './source-adapter.ts';

const utf8 = new TextEncoder();

const collect = async (
  inputs: ReadonlyArray<Uint8Array>,
  path = 'a.log',
  baseOffset = 0,
): Promise<LogLineFrame[]> => {
  const splitter = createByteLineSplitter(path, baseOffset);
  const writer = splitter.writable.getWriter();
  const reader = splitter.readable.getReader();
  const frames: LogLineFrame[] = [];

  const reading = (async () => {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      frames.push(value);
    }
  })();

  for (const chunk of inputs) {
    await writer.write(chunk);
  }
  await writer.close();
  await reading;
  return frames;
};

describe('createByteLineSplitter', () => {
  it('splits a single chunk on \\n with correct byte ranges', async () => {
    // 'a\nb\nc' → bytes [97,10,98,10,99]
    const frames = await collect([utf8.encode('a\nb\nc')]);
    expect(frames).toEqual([
      { path: 'a.log', line: 'a', byteStart: 0, byteEnd: 1 },
      { path: 'a.log', line: 'b', byteStart: 2, byteEnd: 3 },
      { path: 'a.log', line: 'c', byteStart: 4, byteEnd: 5 },
    ]);
  });

  it('carries a remainder buffer between chunks (offsets stay correct)', async () => {
    // chunk 1: 'a\nb' → emits 'a' [0,1), buffer 'b' starts at 2
    // chunk 2: 'c\nd' → buffer 'bc\nd', emits 'bc' [2,4), buffer 'd' at 5
    // chunk 3: 'e'   → buffer 'de', no \n
    // flush          → emits 'de' [5,7)
    const frames = await collect([
      utf8.encode('a\nb'),
      utf8.encode('c\nd'),
      utf8.encode('e'),
    ]);
    expect(frames).toEqual([
      { path: 'a.log', line: 'a', byteStart: 0, byteEnd: 1 },
      { path: 'a.log', line: 'bc', byteStart: 2, byteEnd: 4 },
      { path: 'a.log', line: 'de', byteStart: 5, byteEnd: 7 },
    ]);
  });

  it('strips a trailing \\r (CRLF) without including it in byteEnd', async () => {
    // 'a\r\nb' → bytes [97,13,10,98]; byteEnd of 'a' is 1 (excludes \r)
    const frames = await collect([utf8.encode('a\r\nb')]);
    expect(frames).toEqual([
      { path: 'a.log', line: 'a', byteStart: 0, byteEnd: 1 },
      { path: 'a.log', line: 'b', byteStart: 3, byteEnd: 4 },
    ]);
  });

  it('preserves empty lines between content (zero-length byte ranges)', async () => {
    // 'a\n\nb' → frames 'a' [0,1), '' [2,2), 'b' [3,4)
    const frames = await collect([utf8.encode('a\n\nb')]);
    expect(frames).toEqual([
      { path: 'a.log', line: 'a', byteStart: 0, byteEnd: 1 },
      { path: 'a.log', line: '', byteStart: 2, byteEnd: 2 },
      { path: 'a.log', line: 'b', byteStart: 3, byteEnd: 4 },
    ]);
  });

  it('emits the trailing line when stream closes without final \\n', async () => {
    const frames = await collect([utf8.encode('hello')]);
    expect(frames).toEqual([
      { path: 'a.log', line: 'hello', byteStart: 0, byteEnd: 5 },
    ]);
  });

  it('drops a solo trailing \\r at EOF (no zero-length frame)', async () => {
    const frames = await collect([utf8.encode('a\r')]);
    expect(frames).toEqual([
      { path: 'a.log', line: 'a', byteStart: 0, byteEnd: 1 },
    ]);
  });

  it('drops the empty trailing line after a final \\n', async () => {
    const frames = await collect([utf8.encode('a\nb\n')]);
    expect(frames).toEqual([
      { path: 'a.log', line: 'a', byteStart: 0, byteEnd: 1 },
      { path: 'a.log', line: 'b', byteStart: 2, byteEnd: 3 },
    ]);
  });

  it('is empty-input safe', async () => {
    expect(await collect([])).toEqual([]);
    expect(await collect([new Uint8Array(0)])).toEqual([]);
  });

  it('counts UTF-8 multi-byte characters in bytes, not chars', async () => {
    // '😀' is 4 bytes (U+1F600 → F0 9F 98 80). Frame should have byteEnd=4.
    const frames = await collect([utf8.encode('😀\nb')]);
    expect(frames).toEqual([
      { path: 'a.log', line: '😀', byteStart: 0, byteEnd: 4 },
      { path: 'a.log', line: 'b', byteStart: 5, byteEnd: 6 },
    ]);
  });

  it('handles a UTF-8 sequence split across chunks correctly', async () => {
    // '😀\nx' = [F0 9F 98 80 0A 78]. Split chunks at byte index 2 — first
    // chunk has only 2 bytes of the 4-byte char. The decoder must wait for
    // the second chunk before emitting the line.
    const all = utf8.encode('😀\nx');
    const c1 = all.slice(0, 2);
    const c2 = all.slice(2);
    const frames = await collect([c1, c2]);
    expect(frames).toEqual([
      { path: 'a.log', line: '😀', byteStart: 0, byteEnd: 4 },
      { path: 'a.log', line: 'x', byteStart: 5, byteEnd: 6 },
    ]);
  });

  it('respects baseOffset for chunked-spool callers', async () => {
    // Caller is reading a slice that starts at byte 1000 in the underlying
    // file. Emitted offsets are absolute (1000 + local).
    const frames = await collect([utf8.encode('a\nb')], 'chunk-3.bin', 1000);
    expect(frames).toEqual([
      { path: 'chunk-3.bin', line: 'a', byteStart: 1000, byteEnd: 1001 },
      { path: 'chunk-3.bin', line: 'b', byteStart: 1002, byteEnd: 1003 },
    ]);
  });

  it('does not leak `\\r` from one chunk into the next line', async () => {
    // 'a\r' arrives in chunk 1, '\nb' in chunk 2. Splitter should treat the
    // \r as the CRLF prefix and emit 'a' [0,1), then 'b' [3,4).
    const frames = await collect([utf8.encode('a\r'), utf8.encode('\nb')]);
    expect(frames).toEqual([
      { path: 'a.log', line: 'a', byteStart: 0, byteEnd: 1 },
      { path: 'a.log', line: 'b', byteStart: 3, byteEnd: 4 },
    ]);
  });
});
