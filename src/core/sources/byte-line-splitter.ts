import type { LogLineFrame } from './source-adapter.ts';

/**
 * `TransformStream<Uint8Array, LogLineFrame>` — splits a raw byte stream on
 * `\n`, decodes each line as UTF-8, and emits `LogLineFrame`s tagged with
 * `path` plus the byte range the line occupies in the underlying storage
 * object.
 *
 * Why bytes, not chars: the offset-pointer index needs to slice back into the
 * original `Blob` later, and `Blob.slice` is byte-addressed. Decoding to
 * `string` first (via `TextDecoderStream`) loses byte positions whenever the
 * line contains multi-byte UTF-8 sequences.
 *
 * - `byteEnd` is exclusive and does NOT include the trailing `\r\n` / `\n`.
 *   So `Blob.slice(byteStart, byteEnd).text()` returns the line clean.
 * - `\n` is ASCII `0x0A` — never appears as a partial byte inside a UTF-8
 *   sequence, so byte-search for line breaks is always correct even when
 *   the multi-byte char is split across stream chunks.
 * - `baseOffset` lets callers start the running counter at a non-zero
 *   position. Useful when the stream is itself a slice of a larger file.
 */
export const createByteLineSplitter = (
  path: string,
  baseOffset = 0,
  baseLineNumber = 0,
): TransformStream<Uint8Array, LogLineFrame> => {
  const decoder = new TextDecoder('utf-8');
  // Single growable buffer holding bytes since the last emitted line.
  // `bufferStartOffset` is the global byte offset of `buffer[0]` in the
  // underlying storage. Together they let us emit absolute byte ranges
  // without copying bytes around between chunks.
  // ArrayBufferLike — incoming chunks may be backed by SharedArrayBuffer in
  // some host environments; the buffer state must accept the same union.
  let buffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  let bufferStartOffset = baseOffset;
  // 1-based physical line counter within `path`. `baseLineNumber` lets
  // callers continue numbering across multiple splitters that share one
  // logical "file" (e.g. the stream adapter when chunk files are stitched
  // into one user-visible source).
  let lineNo = baseLineNumber;

  const append = (chunk: Uint8Array<ArrayBufferLike>): void => {
    if (buffer.length === 0) {
      buffer = chunk;
      return;
    }
    const merged = new Uint8Array(buffer.length + chunk.length);
    merged.set(buffer, 0);
    merged.set(chunk, buffer.length);
    buffer = merged;
  };

  return new TransformStream<Uint8Array, LogLineFrame>({
    transform(chunk, controller) {
      if (chunk.length === 0) return;
      append(chunk);

      let scanFrom = 0;
      while (true) {
        const nl = buffer.indexOf(0x0a, scanFrom);
        if (nl === -1) break;

        // Strip a trailing `\r` if present — CRLF terminator.
        let lineEndExclusive = nl;
        if (lineEndExclusive > scanFrom && buffer[lineEndExclusive - 1] === 0x0d) {
          lineEndExclusive -= 1;
        }

        const lineBytes = buffer.subarray(scanFrom, lineEndExclusive);
        const line = decoder.decode(lineBytes);
        lineNo += 1;
        controller.enqueue({
          path,
          line,
          byteStart: bufferStartOffset + scanFrom,
          byteEnd: bufferStartOffset + lineEndExclusive,
          lineNumber: lineNo,
        });
        scanFrom = nl + 1;
      }

      // Trim consumed bytes so future chunks don't keep growing the buffer.
      if (scanFrom > 0) {
        bufferStartOffset += scanFrom;
        buffer = buffer.subarray(scanFrom);
      }
    },

    flush(controller) {
      if (buffer.length === 0) return;
      // Final line without a `\n` terminator. Strip a solo trailing `\r`.
      let lineEndExclusive = buffer.length;
      if (lineEndExclusive > 0 && buffer[lineEndExclusive - 1] === 0x0d) {
        lineEndExclusive -= 1;
      }
      if (lineEndExclusive > 0) {
        const line = decoder.decode(buffer.subarray(0, lineEndExclusive));
        lineNo += 1;
        controller.enqueue({
          path,
          line,
          byteStart: bufferStartOffset,
          byteEnd: bufferStartOffset + lineEndExclusive,
          lineNumber: lineNo,
        });
      }
      buffer = new Uint8Array(0);
    },
  });
};
