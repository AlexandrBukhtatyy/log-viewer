import type { LogSource } from '../types/log-source.ts';

/**
 * Uniform contract for every log source. Adapter only knows how to produce a
 * stream of decoded lines — parsing happens downstream in the parser pool.
 *
 * Status updates are owned by the ingest-orchestrator, not the adapter — adapters
 * stay focused on opening/closing the underlying resource.
 */
export interface LogSourceAdapter {
  readonly source: LogSource;
  /** Open the source. Returns a ReadableStream of decoded lines (no trailing \n). */
  open: (signal: AbortSignal) => Promise<ReadableStream<string>>;
  /** Stop and release resources. Idempotent. */
  close: () => Promise<void>;
}

export type LogSourceAdapterFactory = (source: LogSource) => LogSourceAdapter;
