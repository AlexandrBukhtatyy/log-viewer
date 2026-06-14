import type { LogSource, UrlLogSource } from '../types/log-source.ts';
import { OpfsSingleSpoolWriter } from '../storage/opfs-spool.ts';
import { createByteLineSplitter } from './byte-line-splitter.ts';
import type {
  LogSourceAdapter,
  LogSourceAdapterFactory,
} from './source-adapter.ts';

const isUrlSource = (s: LogSource): s is UrlLogSource => s.kind === 'url';

/**
 * URL fetch → tee → (a) OPFS spool writer for later lazy resolve, (b)
 * byte-line-splitter for live ingest. Both branches see the same byte
 * sequence, so the offsets emitted by the splitter match what the writer
 * persisted. Spool-write errors are logged and skipped; ingest still runs
 * (you just lose body-resolution after reload).
 */
export const createUrlAdapter: LogSourceAdapterFactory = (source) => {
  if (!isUrlSource(source)) {
    throw new Error(
      `createUrlAdapter: expected source.kind='url', got '${source.kind}'`,
    );
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

      const [forSpool, forIngest] = response.body.tee();

      // Fire-and-forget spool persistence. We don't await it from `open` —
      // ingest must start streaming immediately. If the spool write fails,
      // body resolution becomes blank but the source is still ingested.
      void (async () => {
        try {
          const writer = await OpfsSingleSpoolWriter.open(source.id);
          const reader = forSpool.getReader();
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value && value.byteLength > 0) {
              await writer.write(value);
            }
          }
          await writer.close();
        } catch (err) {
          console.warn(
            `[url-adapter] OPFS spool write failed for ${source.id}:`,
            err instanceof Error ? err.message : err,
          );
          try {
            await forSpool.cancel();
          } catch {
            /* drained already */
          }
        }
      })();

      return forIngest.pipeThrough(createByteLineSplitter(''));
    },
    close: async () => {
      aborter?.abort();
      aborter = null;
    },
  };

  return adapter;
};
