import { describe, expect, it } from 'vitest';
import { createLineSplitter } from './line-splitter.ts';

const collect = async (
  inputs: ReadonlyArray<string>,
): Promise<string[]> => {
  const splitter = createLineSplitter();
  const writer = splitter.writable.getWriter();
  const reader = splitter.readable.getReader();
  const lines: string[] = [];

  const readPromise = (async () => {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      lines.push(value);
    }
  })();

  for (const input of inputs) {
    await writer.write(input);
  }
  await writer.close();
  await readPromise;
  return lines;
};

describe('createLineSplitter', () => {
  it('splits single chunk on \\n', async () => {
    expect(await collect(['a\nb\nc'])).toEqual(['a', 'b', 'c']);
  });

  it('splits across multiple chunks (remainder buffered)', async () => {
    // 'a\nb' → emit 'a', remainder 'b'
    // 'c\nd' → buffer 'bc\nd' → emit 'bc', remainder 'd'
    // 'e'    → buffer 'de', no \n
    // flush  → emit 'de'
    expect(await collect(['a\nb', 'c\nd', 'e'])).toEqual(['a', 'bc', 'de']);
  });

  it('strips trailing \\r (CRLF)', async () => {
    expect(await collect(['a\r\nb\r\nc'])).toEqual(['a', 'b', 'c']);
  });

  it('handles trailing newline (no spurious empty line)', async () => {
    expect(await collect(['a\nb\n'])).toEqual(['a', 'b']);
  });

  it('preserves empty lines between content', async () => {
    expect(await collect(['a\n\nb'])).toEqual(['a', '', 'b']);
  });

  it('emits remainder when stream closes mid-line', async () => {
    expect(await collect(['hello'])).toEqual(['hello']);
  });

  it('drops solo trailing \\r at EOF (no zero-length line)', async () => {
    expect(await collect(['a\r'])).toEqual(['a']);
  });

  it('handles empty input gracefully', async () => {
    expect(await collect([])).toEqual([]);
    expect(await collect([''])).toEqual([]);
  });
});
