import type { DirectoryLogSource, LogSource } from '../types/log-source.ts';
import { createLineSplitter } from './line-splitter.ts';
import type {
  LogLineFrame,
  LogSourceAdapter,
  LogSourceAdapterFactory,
} from './source-adapter.ts';
import { walkDirectory } from './walk-directory.ts';

const isDirectorySource = (s: LogSource): s is DirectoryLogSource =>
  s.kind === 'directory';

/**
 * Recursively reads every text-like file under the source root and emits
 * `LogLineFrame` per line tagged with its forward-slash relative path. Walk
 * order is alphabetical, depth-first; bad files are logged and skipped so
 * one corrupt entry doesn't kill the whole ingest.
 */
export const createDirectoryAdapter: LogSourceAdapterFactory = (source) => {
  if (!isDirectorySource(source)) {
    throw new Error(
      `createDirectoryAdapter: expected source.kind='directory', got '${source.kind}'`,
    );
  }
  let aborter: AbortController | null = null;

  return {
    source,
    open: async (signal) => {
      aborter = new AbortController();
      const onParentAbort = () => aborter?.abort();
      signal.addEventListener('abort', onParentAbort, { once: true });
      const localSignal = aborter.signal;
      const dir = source.handle;
      const glob = source.glob;

      return new ReadableStream<LogLineFrame>({
        async start(controller) {
          try {
            for await (const entry of walkDirectory(dir, {
              glob,
              signal: localSignal,
            })) {
              if (localSignal.aborted) break;
              if (!entry.file) continue;
              const { path, handle } = entry.file;
              try {
                const file = await handle.getFile();
                const reader = file
                  .stream()
                  .pipeThrough(new TextDecoderStream())
                  .pipeThrough(createLineSplitter())
                  .getReader();
                try {
                  while (!localSignal.aborted) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    if (typeof value === 'string') {
                      controller.enqueue({ path, line: value });
                    }
                  }
                } finally {
                  await reader.cancel().catch(() => undefined);
                }
              } catch (err) {
                console.warn(
                  `[directory-adapter] skipping '${path}':`,
                  err instanceof Error ? err.message : err,
                );
              }
            }
            if (!localSignal.aborted) controller.close();
          } catch (err) {
            controller.error(err);
          }
        },
      });
    },
    close: async () => {
      aborter?.abort();
      aborter = null;
    },
  } satisfies LogSourceAdapter;
};
