import type { LogSource } from '../types/log-source.ts';

/**
 * One decoded log line as it leaves an adapter.
 *
 * - `path` — for `directory` it's the forward-slash relative path from the
 *   directory root (`sub/a.log`); for sources without inner structure
 *   (file/text/url/stream/snapshot) it's `null`.
 * - `byteStart` / `byteEnd` — byte offsets inside the storage object the
 *   `path` resolves to (FS file or OPFS spool/chunk). `byteEnd` is exclusive
 *   and does NOT include trailing `\r\n` / `\n`. **Currently optional** —
 *   adapters that haven't been migrated to the byte-aware splitter omit
 *   these; the indexer treats `undefined` as "no byte pointer, fall back to
 *   storing the body" (legacy behaviour). Phase 4 makes them required.
 *
 * Downstream the orchestrator groups frames by `path`, and `path` ends up in
 * `entry.fields.file_path` for sidebar filtering.
 */
export interface LogLineFrame {
  readonly path: string | null;
  readonly line: string;
  readonly byteStart?: number;
  readonly byteEnd?: number;
}

/**
 * Uniform contract for every log source. Adapter only knows how to produce a
 * stream of decoded line frames — parsing happens downstream in the parser
 * pool. Status updates are owned by the ingest-orchestrator, not the
 * adapter — adapters stay focused on opening/closing the underlying resource.
 */
export interface LogSourceAdapter {
  readonly source: LogSource;
  /** Open the source. Returns a ReadableStream of `{ path, line }` frames. */
  open: (signal: AbortSignal) => Promise<ReadableStream<LogLineFrame>>;
  /** Stop and release resources. Idempotent. */
  close: () => Promise<void>;
}

export type LogSourceAdapterFactory = (source: LogSource) => LogSourceAdapter;

/**
 * Wrap a `ReadableStream<string>` into a `ReadableStream<LogLineFrame>`,
 * tagging every line with the same `path`. Used by adapters whose source has
 * no inner file structure (path stays `null`). Phase 4 will retire this in
 * favour of byte-line-splitter directly on the raw byte stream.
 */
export const tagLineStream = (
  source: ReadableStream<string>,
  path: string | null,
): ReadableStream<LogLineFrame> =>
  source.pipeThrough(
    new TransformStream<string, LogLineFrame>({
      transform(line, controller) {
        controller.enqueue({ path, line });
      },
    }),
  );
