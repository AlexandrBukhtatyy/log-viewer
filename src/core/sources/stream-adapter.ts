import type { LogSource, StreamLogSource } from '../types/log-source.ts';
import {
  tagLineStream,
  type LogSourceAdapter,
  type LogSourceAdapterFactory,
} from './source-adapter.ts';

const isStreamSource = (s: LogSource): s is StreamLogSource =>
  s.kind === 'stream';

const MAX_BUFFERED_LINES = 5000;

const splitLines = (data: string): string[] => {
  if (data.length === 0) return [];
  return data.split('\n').filter((line) => line.length > 0);
};

/**
 * WebSocket/SSE source. Each transport message is treated as one or more log
 * lines (split on `\n`). When the consumer (chunker → parser-pool → indexer) is
 * slower than the producer, lines are buffered up to MAX_BUFFERED_LINES; once
 * the buffer is full, **oldest lines are dropped** (per план §«backpressure для
 * стримов»).
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

      const queue: string[] = [];
      let controller: ReadableStreamDefaultController<string> | null = null;
      let closed = false;
      // TODO(diag): expose dropped-line count via SourceStatus once the
      //   diagnostics panel from плана §«Дополнительно E» is wired.

      const flushQueue = () => {
        if (controller === null) return;
        while (queue.length > 0) {
          const desired = controller.desiredSize;
          if (desired !== null && desired <= 0) break;
          const line = queue.shift()!;
          controller.enqueue(line);
        }
      };

      const ingest = (raw: unknown) => {
        if (closed) return;
        if (typeof raw !== 'string') {
          // Binary frames not handled in MVP; could decode ArrayBuffer/Blob in future.
          return;
        }
        const lines = splitLines(raw);
        if (lines.length === 0) return;
        if (controller !== null) {
          flushQueue();
          for (const line of lines) {
            const desired = controller.desiredSize;
            if (desired === null || desired > 0) {
              controller.enqueue(line);
            } else {
              queue.push(line);
            }
          }
        } else {
          queue.push(...lines);
        }
        // Drop oldest if buffered queue is too large.
        if (queue.length > MAX_BUFFERED_LINES) {
          queue.splice(0, queue.length - MAX_BUFFERED_LINES);
        }
      };

      const fail = (err: unknown) => {
        if (closed) return;
        closed = true;
        controller?.error(err);
        closeConn();
      };

      const finish = () => {
        if (closed) return;
        closed = true;
        flushQueue();
        controller?.close();
        closeConn();
      };

      if (source.transport === 'ws') {
        const ws = new WebSocket(source.url);
        ws.onmessage = (e) => ingest(e.data);
        ws.onerror = () =>
          fail(new Error(`stream-adapter: websocket error for ${source.url}`));
        ws.onclose = (e) => {
          if (e.wasClean) finish();
          else fail(new Error(`stream-adapter: websocket closed code=${e.code}`));
        };
        conn = ws;
      } else {
        const es = new EventSource(source.url);
        es.onmessage = (e) => ingest(e.data);
        es.onerror = () => {
          // EventSource auto-reconnects on transient errors; we only fail when
          // readyState is CLOSED (terminal). MVP: treat any onerror past
          // initial connect as terminal — server should send `Cache-Control: no-store`.
          if (es.readyState === EventSource.CLOSED) {
            fail(new Error(`stream-adapter: eventsource error for ${source.url}`));
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

      const lineStream = new ReadableStream<string>({
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
        },
      });
      return tagLineStream(lineStream, '');
    },
    close: async () => {
      aborter?.abort();
      aborter = null;
      closeConn();
    },
  } satisfies LogSourceAdapter;
};
