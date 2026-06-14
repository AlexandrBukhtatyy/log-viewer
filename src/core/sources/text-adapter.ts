import type { LogSource, TextLogSource } from '../types/log-source.ts';
import { OpfsSingleSpoolWriter } from '../storage/opfs-spool.ts';
import { createByteLineSplitter } from './byte-line-splitter.ts';
import type {
  LogSourceAdapter,
  LogSourceAdapterFactory,
} from './source-adapter.ts';

const isTextSource = (s: LogSource): s is TextLogSource => s.kind === 'text';

/**
 * Pasted/text-source: the body comes inline on the LogSourceInput. We
 * persist it to `lv-spool/<sourceId>/data.bin` so the lazy resolver can
 * later slice it back, and emit byte-aware frames whose offsets match the
 * spool layout (single sequential write, so offsets are simply
 * `[0..byteLength)` with `\n` boundaries — exactly what
 * `createByteLineSplitter` would produce on the same buffer).
 */
export const createTextAdapter: LogSourceAdapterFactory = (source) => {
  if (!isTextSource(source)) {
    throw new Error(
      `createTextAdapter: expected source.kind='text', got '${source.kind}'`,
    );
  }

  const adapter: LogSourceAdapter = {
    source,
    open: async () => {
      const bytes = new TextEncoder().encode(source.text);

      // Persist into OPFS so the read-path can resolve raw/message later.
      // Failures are non-fatal (we fall back to ingest-only with no body
      // resolution; status will still flow normally).
      try {
        const writer = await OpfsSingleSpoolWriter.open(source.id);
        if (bytes.byteLength > 0) await writer.write(bytes);
        await writer.close();
      } catch (err) {
        console.warn(
          `[text-adapter] OPFS spool write failed for ${source.id}:`,
          err instanceof Error ? err.message : err,
        );
      }

      // Single-chunk byte stream → byte-aware splitter; offsets line up
      // with what we just wrote into the spool.
      return new ReadableStream<Uint8Array>({
        start(controller) {
          if (bytes.byteLength > 0) controller.enqueue(bytes);
          controller.close();
        },
      }).pipeThrough(createByteLineSplitter(''));
    },
    close: async () => {
      /* nothing to clean up beyond what coordinator.removeSource does */
    },
  };

  return adapter;
};
