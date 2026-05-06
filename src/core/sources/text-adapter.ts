import type { LogSource, TextLogSource } from '../types/log-source.ts';
import { createLineSplitter } from './line-splitter.ts';
import {
  tagLineStream,
  type LogSourceAdapter,
  type LogSourceAdapterFactory,
} from './source-adapter.ts';

const isTextSource = (s: LogSource): s is TextLogSource => s.kind === 'text';

export const createTextAdapter: LogSourceAdapterFactory = (source) => {
  if (!isTextSource(source)) {
    throw new Error(`createTextAdapter: expected source.kind='text', got '${source.kind}'`);
  }

  const adapter: LogSourceAdapter = {
    source,
    open: async () => {
      // Whole text fed as a single chunk; line-splitter does the work downstream.
      const stream = new ReadableStream<string>({
        start(controller) {
          controller.enqueue(source.text);
          controller.close();
        },
      });
      return tagLineStream(stream.pipeThrough(createLineSplitter()), '');
    },
    close: async () => {
      /* nothing to clean up */
    },
  };

  return adapter;
};
