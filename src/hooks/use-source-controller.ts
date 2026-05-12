import { useCallback } from 'react';
import { useViewStore } from '../app/providers/view-store-context.ts';
import type { ResumeReport } from '../core/rpc/coordinator.contract.ts';
import type {
  CloudProvider,
  DbDialect,
  SourceId,
} from '../core/types/index.ts';

export interface UseSourceController {
  addFile: (file: File) => Promise<SourceId>;
  addDirectory: (opts?: {
    handle?: FileSystemDirectoryHandle;
    name?: string;
    watch?: boolean;
    glob?: string;
    parserId?: string;
  }) => Promise<SourceId | null>;
  addText: (name: string, text: string) => Promise<SourceId>;
  addUrl: (
    url: string,
    headers?: Readonly<Record<string, string>>,
  ) => Promise<SourceId>;
  addStream: (url: string, transport?: 'ws' | 'sse') => Promise<SourceId>;
  // Phase 1 stubs — coordinator routes to a not-implemented adapter; the resulting
  // source surfaces as `SourceStatus.kind === 'error'` until each integration ADR
  // ships its real adapter (see core/sources/stub-adapters.ts).
  addRemoteSsh: (params: {
    name?: string;
    host: string;
    user?: string;
    paths?: ReadonlyArray<string>;
    keyPath?: string;
  }) => Promise<SourceId>;
  addCloud: (params: {
    name?: string;
    provider: CloudProvider;
    query?: string;
    region?: string;
  }) => Promise<SourceId>;
  addK8s: (params: {
    name?: string;
    cluster: string;
    namespace?: string;
    pod?: string;
    container?: string;
  }) => Promise<SourceId>;
  addBus: (params: {
    name?: string;
    broker: string;
    topic: string;
    group?: string;
  }) => Promise<SourceId>;
  addDb: (params: {
    name?: string;
    dialect: DbDialect;
    url: string;
    query: string;
  }) => Promise<SourceId>;
  addSnapshot: (file: File) => Promise<SourceId>;
  removeSource: (id: SourceId) => Promise<void>;
  clearAll: () => Promise<void>;
  /**
   * Re-attach previously persisted directory sources after page reload.
   * Granted handles start ingest immediately; the rest surface as
   * `SourceStatus.kind === 'permission-required'` and need `grantPermission`.
   */
  resumePersistedSources: () => Promise<ResumeReport>;
  /**
   * Request read permission for a persisted directory and (on success) start
   * ingest. Must be called from a fresh user gesture (the UI's "Grant access"
   * click) — browsers reject `requestPermission` otherwise.
   */
  grantPermission: (id: SourceId) => Promise<boolean>;
  /**
   * Abort the in-flight ingest for a source. Already-indexed entries stay;
   * status transitions to `done` with the partial entryCount.
   */
  cancelSource: (id: SourceId) => Promise<void>;
}

export const useSourceController = (): UseSourceController => {
  const store = useViewStore();

  const addFile = useCallback(
    (file: File) => store.getState().addFile(file),
    [store],
  );

  const addDirectory = useCallback<UseSourceController['addDirectory']>(
    (opts) => store.getState().addDirectory(opts),
    [store],
  );

  const addText = useCallback(
    (name: string, text: string) => store.getState().addText(name, text),
    [store],
  );

  const addUrl = useCallback(
    (url: string, headers?: Readonly<Record<string, string>>) =>
      store.getState().addUrl(url, headers),
    [store],
  );

  const addStream = useCallback(
    (url: string, transport?: 'ws' | 'sse') =>
      store.getState().addStream(url, transport),
    [store],
  );

  const addRemoteSsh = useCallback<UseSourceController['addRemoteSsh']>(
    (params) => store.getState().addRemoteSsh(params),
    [store],
  );
  const addCloud = useCallback<UseSourceController['addCloud']>(
    (params) => store.getState().addCloud(params),
    [store],
  );
  const addK8s = useCallback<UseSourceController['addK8s']>(
    (params) => store.getState().addK8s(params),
    [store],
  );
  const addBus = useCallback<UseSourceController['addBus']>(
    (params) => store.getState().addBus(params),
    [store],
  );
  const addDb = useCallback<UseSourceController['addDb']>(
    (params) => store.getState().addDb(params),
    [store],
  );
  const addSnapshot = useCallback<UseSourceController['addSnapshot']>(
    (file) => store.getState().addSnapshot(file),
    [store],
  );

  const removeSource = useCallback(
    (id: SourceId) => store.getState().removeSource(id),
    [store],
  );

  const clearAll = useCallback(
    () => store.getState().clearAll(),
    [store],
  );

  const resumePersistedSources = useCallback(
    () => store.getState().resumePersistedSources(),
    [store],
  );

  const grantPermission = useCallback(
    (id: SourceId) => store.getState().grantPermission(id),
    [store],
  );

  const cancelSource = useCallback(
    (id: SourceId) => store.getState().cancelSource(id),
    [store],
  );

  return {
    addFile,
    addDirectory,
    addText,
    addUrl,
    addStream,
    addRemoteSsh,
    addCloud,
    addK8s,
    addBus,
    addDb,
    addSnapshot,
    removeSource,
    clearAll,
    resumePersistedSources,
    grantPermission,
    cancelSource,
  };
};
