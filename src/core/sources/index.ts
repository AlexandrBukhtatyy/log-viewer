import type { LogSourceAdapterFactory } from './source-adapter.ts';
import { createDirectoryAdapter } from './directory-adapter.ts';
import { createFileAdapter } from './file-adapter.ts';
import { createStreamAdapter } from './stream-adapter.ts';
import { createTextAdapter } from './text-adapter.ts';
import { createUrlAdapter } from './url-adapter.ts';
import type { LogSourceKind } from '../types/log-source.ts';

export { createLineSplitter } from './line-splitter.ts';
export type { LogSourceAdapter, LogSourceAdapterFactory } from './source-adapter.ts';
export { createDirectoryAdapter } from './directory-adapter.ts';
export { createFileAdapter } from './file-adapter.ts';
export { createStreamAdapter } from './stream-adapter.ts';
export { createTextAdapter } from './text-adapter.ts';
export { createUrlAdapter } from './url-adapter.ts';

/**
 * Default adapter registry. Adding a new source kind = adding an entry here +
 * implementing the adapter — hooks and UI don't change.
 */
export const defaultAdapterFactories: Partial<
  Record<LogSourceKind, LogSourceAdapterFactory>
> = {
  file: createFileAdapter,
  directory: createDirectoryAdapter,
  stream: createStreamAdapter,
  text: createTextAdapter,
  url: createUrlAdapter,
};
