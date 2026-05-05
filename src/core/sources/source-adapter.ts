import type { LogSource } from '../types/log-source.ts';

/**
 * One decoded log line as it leaves an adapter, tagged with the path-inside-
 * the-source it came from. `path` is `null` for sources that don't have an
 * inner file structure (file/text/url/stream/snapshot); for `directory` it's
 * the forward-slash relative path from the directory root (e.g. `sub/a.log`).
 *
 * Downstream the orchestrator groups frames by `path` so each parser batch is
 * homogenous, and the `path` ends up in `entry.fields.file_path` — that's
 * what the sidebar uses to filter logs by individual file inside a directory.
 */
export interface LogLineFrame {
  readonly path: string | null;
  readonly line: string;
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
 * no inner file structure (path stays `null`).
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
