import type { LogSource, StreamLogSource } from '../types/log-source.ts';
import { OpfsChunkedSpoolWriter } from '../storage/opfs-spool.ts';
import type {
  LogLineFrame,
  LogSourceAdapter,
  LogSourceAdapterFactory,
} from './source-adapter.ts';

const isStreamSource = (s: LogSource): s is StreamLogSource =>
  s.kind === 'stream';

/**
 * Backpressure cap on undelivered frames. If the chunker / parser-pool /
 * indexer can't keep up with the producer, oldest frames are dropped.
 */
const MAX_BUFFERED_FRAMES = 5000;

/**
 * WebSocket / SSE source — backed by a chunked OPFS spool. Each transport
 * message becomes one OPFS file `lv-spool/<sourceId>/<seq>.bin`, and the
 * adapter emits `LogLineFrame`s with `path = '<seq>'` plus byte offsets
 * inside that single chunk file (so the lazy-resolver can later slice the
 * exact bytes back).
 *
 * Why chunk-per-message instead of one growing file: writer and reader run
 * concurrently — a fresh chunk doesn't contend on an open writable handle
 * that the reader is also slicing. Stale data also evicts cleanly with a
 * single `removeEntry` per chunk file (LRU politics is Phase 11+).
 *
 * Partial lines are accumulated as a `tail` buffer between messages so that
 * each chunk file contains only complete lines (each terminated with `\n`).
 * This keeps offsets honest for the resolver — slicing inside the chunk
 * never lands in the middle of a UTF-8 sequence on a sane producer.
 */
export const createStreamAdapter: LogSourceAdapterFactory = (source) => {
  if (!isStreamSource(source)) {
    throw new Error(
      `createStreamAdapter: expected source.kind='stream', got '${source.kind}'`,
    );
  }
  let aborter: AbortController | null = null;
  let conn: WebSocket | EventSource | null = null;

  const closeConn = () => {
    if (conn instanceof WebSocket) {
      try {
        conn.close(1000, 'closed');
      } catch {
        /* already closed */
      }
    } else if (conn instanceof EventSource) {
      conn.close();
    }
    conn = null;
  };

  return {
    source,
    open: async (signal) => {
      aborter = new AbortController();
      const onParentAbort = () => aborter?.abort();
      signal.addEventListener('abort', onParentAbort, { once: true });
      const localSignal = aborter.signal;

      const writer = await OpfsChunkedSpoolWriter.open(source.id);

      const queue: LogLineFrame[] = [];
      let controller: ReadableStreamDefaultController<LogLineFrame> | null =
        null;
      let closed = false;
      let tail: Uint8Array = new Uint8Array(0);
      const encoder = new TextEncoder();
      const decoder = new TextDecoder('utf-8', { fatal: false });
      // Stream sources are perceived by the user as one continuous log
      // even though the OPFS spool splits them into per-message chunk
      // files. Keep a single running counter so `LogEntry.lineNumber` is
      // monotonic across the whole stream.
      let lineNo = 0;

      const flushQueue = () => {
        if (controller === null) return;
        while (queue.length > 0) {
          const desired = controller.desiredSize;
          if (desired !== null && desired <= 0) break;
          controller.enqueue(queue.shift()!);
        }
      };

      const enqueueFrame = (frame: LogLineFrame) => {
        if (controller !== null) {
          const desired = controller.desiredSize;
          if (desired === null || desired > 0) {
            controller.enqueue(frame);
            return;
          }
        }
        queue.push(frame);
        if (queue.length > MAX_BUFFERED_FRAMES) {
          queue.splice(0, queue.length - MAX_BUFFERED_FRAMES);
        }
      };

      /** Push a chunk to OPFS, then synchronously walk it for frames. */
      const handleBytes = async (incoming: Uint8Array) => {
        if (closed) return;
        // Combine tail + incoming so chunks always end on a complete line.
        let bytes: Uint8Array;
        if (tail.byteLength > 0) {
          const merged = new Uint8Array(tail.byteLength + incoming.byteLength);
          merged.set(tail);
          merged.set(incoming, tail.byteLength);
          bytes = merged;
          tail = new Uint8Array(0);
        } else {
          bytes = incoming;
        }

        // Find the last `\n`; everything past it is a partial line for the
        // next message.
        let lastNl = -1;
        for (let i = bytes.byteLength - 1; i >= 0; i--) {
          if (bytes[i] === 0x0a) {
            lastNl = i;
            break;
          }
        }
        if (lastNl === -1) {
          tail = bytes;
          return;
        }
        const complete = bytes.subarray(0, lastNl + 1);
        tail = bytes.subarray(lastNl + 1);

        let chunkSeq: number;
        try {
          const r = await writer.pushChunk(complete);
          chunkSeq = r.chunkSeq;
        } catch (err) {
          console.warn(
            `[stream-adapter] OPFS chunk write failed for ${source.id}:`,
            err instanceof Error ? err.message : err,
          );
          return;
        }
        const path = String(chunkSeq);

        // Walk `complete` for line frames; offsets are local to this chunk.
        let lineStart = 0;
        for (let i = 0; i < complete.byteLength; i++) {
          if (complete[i] !== 0x0a) continue;
          let lineEnd = i;
          if (lineEnd > lineStart && complete[lineEnd - 1] === 0x0d) {
            lineEnd -= 1;
          }
          if (lineEnd > lineStart) {
            lineNo += 1;
            enqueueFrame({
              path,
              line: decoder.decode(complete.subarray(lineStart, lineEnd)),
              byteStart: lineStart,
              byteEnd: lineEnd,
              lineNumber: lineNo,
            });
          }
          lineStart = i + 1;
        }
        flushQueue();
      };

      const ingest = (raw: unknown) => {
        if (closed) return;
        if (typeof raw === 'string') {
          // Re-encode to UTF-8 bytes; the chunk file stores bytes, not
          // chars, and the resolver slices it back as bytes.
          void handleBytes(encoder.encode(raw));
          return;
        }
        if (raw instanceof ArrayBuffer) {
          void handleBytes(new Uint8Array(raw));
          return;
        }
        if (raw instanceof Uint8Array) {
          void handleBytes(raw);
          return;
        }
        if (raw instanceof Blob) {
          void raw
            .arrayBuffer()
            .then((buf) => handleBytes(new Uint8Array(buf)));
          return;
        }
        // Other binary types not handled in MVP.
      };

      const fail = (err: unknown) => {
        if (closed) return;
        closed = true;
        controller?.error(err);
        closeConn();
        void writer.close().catch(() => undefined);
      };

      const finish = () => {
        if (closed) return;
        closed = true;
        flushQueue();
        controller?.close();
        closeConn();
        void writer.close().catch(() => undefined);
      };

      if (source.transport === 'ws') {
        const ws = new WebSocket(source.url);
        ws.binaryType = 'arraybuffer';
        ws.onmessage = (e) => ingest(e.data);
        ws.onerror = () =>
          fail(new Error(`stream-adapter: websocket error for ${source.url}`));
        ws.onclose = (e) => {
          if (e.wasClean) finish();
          else
            fail(new Error(`stream-adapter: websocket closed code=${e.code}`));
        };
        conn = ws;
      } else {
        const es = new EventSource(source.url);
        es.onmessage = (e) => ingest(e.data);
        es.onerror = () => {
          if (es.readyState === EventSource.CLOSED) {
            fail(
              new Error(`stream-adapter: eventsource error for ${source.url}`),
            );
          }
        };
        conn = es;
      }

      localSignal.addEventListener(
        'abort',
        () => {
          finish();
        },
        { once: true },
      );

      return new ReadableStream<LogLineFrame>({
        start(c) {
          controller = c;
          flushQueue();
        },
        pull() {
          flushQueue();
        },
        cancel() {
          closed = true;
          closeConn();
          void writer.close().catch(() => undefined);
        },
      });
    },
    close: async () => {
      aborter?.abort();
      aborter = null;
      closeConn();
    },
  } satisfies LogSourceAdapter;
};
