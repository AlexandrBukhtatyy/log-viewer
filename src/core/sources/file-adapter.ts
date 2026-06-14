import type { FileLogSource, LogSource } from '../types/log-source.ts';
import { createLineSplitter } from './line-splitter.ts';
import {
  tagLineStream,
  type LogSourceAdapter,
  type LogSourceAdapterFactory,
} from './source-adapter.ts';

const isFileSource = (s: LogSource): s is FileLogSource => s.kind === 'file';

export const createFileAdapter: LogSourceAdapterFactory = (source) => {
  if (!isFileSource(source)) {
    throw new Error(
      `createFileAdapter: expected source.kind='file', got '${source.kind}'`,
    );
  }
  let aborter: AbortController | null = null;

  const adapter: LogSourceAdapter = {
    source,
    open: async (signal) => {
      aborter = new AbortController();
      const onParentAbort = () => aborter?.abort();
      signal.addEventListener('abort', onParentAbort, { once: true });

      // file.stream() → Uint8Array → text → lines.
      // No await file.text() — we rely entirely on streaming so multi-GB files don't blow memory.
      const lines = source.file
        .stream()
        .pipeThrough(new TextDecoderStream())
        .pipeThrough(createLineSplitter());
      return tagLineStream(lines, '');
    },
    close: async () => {
      aborter?.abort();
      aborter = null;
    },
  };

  return adapter;
};
