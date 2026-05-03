import type { DirectoryLogSource, LogSource } from '../types/log-source.ts';
import { createLineSplitter } from './line-splitter.ts';
import type { LogSourceAdapter, LogSourceAdapterFactory } from './source-adapter.ts';

const isDirectorySource = (s: LogSource): s is DirectoryLogSource =>
  s.kind === 'directory';

const DEFAULT_FILE_EXT_RE = /\.(log|jsonl|ndjson|txt|out|err)$/i;

const globToRegex = (glob: string): RegExp => {
  const escaped = glob
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
};

const matchFile = (name: string, glob?: string): boolean =>
  glob ? globToRegex(glob).test(name) : DEFAULT_FILE_EXT_RE.test(name);

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

      return new ReadableStream<string>({
        async start(controller) {
          try {
            for await (const entry of dir.values()) {
              if (localSignal.aborted) break;
              if (entry.kind !== 'file') continue;
              if (!matchFile(entry.name, glob)) continue;
              const file = await entry.getFile();
              const reader = file
                .stream()
                .pipeThrough(new TextDecoderStream())
                .pipeThrough(createLineSplitter())
                .getReader();
              try {
                while (!localSignal.aborted) {
                  const { value, done } = await reader.read();
                  if (done) break;
                  if (typeof value === 'string') controller.enqueue(value);
                }
              } finally {
                await reader.cancel().catch(() => undefined);
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
