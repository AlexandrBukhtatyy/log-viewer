import type { LogSource, UrlLogSource } from '../types/log-source.ts';
import { createLineSplitter } from './line-splitter.ts';
import {
  tagLineStream,
  type LogSourceAdapter,
  type LogSourceAdapterFactory,
} from './source-adapter.ts';

const isUrlSource = (s: LogSource): s is UrlLogSource => s.kind === 'url';

export const createUrlAdapter: LogSourceAdapterFactory = (source) => {
  if (!isUrlSource(source)) {
    throw new Error(`createUrlAdapter: expected source.kind='url', got '${source.kind}'`);
  }
  let aborter: AbortController | null = null;

  const adapter: LogSourceAdapter = {
    source,
    open: async (signal) => {
      aborter = new AbortController();
      const onParentAbort = () => aborter?.abort();
      signal.addEventListener('abort', onParentAbort, { once: true });

      const response = await fetch(source.url, {
        signal: aborter.signal,
        headers: source.headers ? { ...source.headers } : undefined,
      });
      if (!response.ok) {
        throw new Error(
          `url-adapter: ${response.status} ${response.statusText} for ${source.url}`,
        );
      }
      if (response.body === null) {
        throw new Error(`url-adapter: response body is null for ${source.url}`);
      }
      const lines = response.body
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
