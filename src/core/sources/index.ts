import type { LogSourceAdapterFactory } from './source-adapter.ts';
import { createDirectoryAdapter } from './directory-adapter.ts';
import { createFileAdapter } from './file-adapter.ts';
import { createSnapshotAdapter } from './snapshot-adapter.ts';
import { createStreamAdapter } from './stream-adapter.ts';
import { createTextAdapter } from './text-adapter.ts';
import { createUrlAdapter } from './url-adapter.ts';
import {
  createBusAdapter,
  createCloudAdapter,
  createDbAdapter,
  createK8sAdapter,
  createRemoteSshAdapter,
} from './stub-adapters.ts';
import type { LogSourceKind } from '../types/log-source.ts';

export { createLineSplitter } from './line-splitter.ts';
export type {
  LogSourceAdapter,
  LogSourceAdapterFactory,
} from './source-adapter.ts';
export { createDirectoryAdapter } from './directory-adapter.ts';
export { createFileAdapter } from './file-adapter.ts';
export { createSnapshotAdapter } from './snapshot-adapter.ts';
export { createStreamAdapter } from './stream-adapter.ts';
export { createTextAdapter } from './text-adapter.ts';
export { createUrlAdapter } from './url-adapter.ts';
export {
  createBusAdapter,
  createCloudAdapter,
  createDbAdapter,
  createK8sAdapter,
  createRemoteSshAdapter,
} from './stub-adapters.ts';

/**
 * Default adapter registry. Adding a new source kind = adding an entry here +
 * implementing the adapter — hooks and UI don't change.
 *
 * Stubs throw `not implemented` on open(); see ./stub-adapters.ts.
 */
export const defaultAdapterFactories: Record<
  LogSourceKind,
  LogSourceAdapterFactory
> = {
  file: createFileAdapter,
  directory: createDirectoryAdapter,
  stream: createStreamAdapter,
  text: createTextAdapter,
  url: createUrlAdapter,
  'remote-ssh': createRemoteSshAdapter,
  cloud: createCloudAdapter,
  k8s: createK8sAdapter,
  bus: createBusAdapter,
  db: createDbAdapter,
  snapshot: createSnapshotAdapter,
};
