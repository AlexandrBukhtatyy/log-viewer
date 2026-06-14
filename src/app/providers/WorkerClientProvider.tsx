import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  getOrCreateViewStore,
  subscribeStoreReset,
} from '../../worker-client/log-client.ts';
import type { ViewStore } from '../../worker-client/log-client.ts';
import { ViewStoreContext } from './view-store-context.ts';

export interface WorkerClientProviderProps {
  readonly children?: ReactNode;
}

/**
 * Bind the singleton ViewStore (see log-client.getOrCreateViewStore) into
 * React context. We deliberately do NOT destroy the store on unmount: the
 * coordinator/indexer workers and the OPFS SAH-pool are application-scoped,
 * and React 19 StrictMode would otherwise dispose them on the dev-only
 * double-invoke, leaving the next mount with a half-dead worker pool.
 *
 * Exception: bfcache restore. When the page returns from the back/forward
 * cache log-client tears down the worker pipeline and notifies via
 * `subscribeStoreReset` — we swap the store and bump `key` on the provider
 * to fully re-mount the subtree (subscriptions, refs, source/entry ids).
 * See ADR-0027.
 */
export const WorkerClientProvider = ({
  children,
}: WorkerClientProviderProps) => {
  const [store, setStore] = useState<ViewStore>(() => getOrCreateViewStore());
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    return subscribeStoreReset(() => {
      setStore(getOrCreateViewStore());
      setEpoch((e) => e + 1);
    });
  }, []);

  // Eagerly hydrate persisted sources on mount. Without this the coordinator
  // worker stays asleep (lazy by ADR-0014) until the first user action — so
  // the sidebar is empty after reload, and the next Add Source races with
  // resume and produces a duplicate. resumePersistedSources is idempotent.
  useEffect(() => {
    void store.getState().resumePersistedSources();
  }, [store]);

  return (
    <ViewStoreContext.Provider value={store} key={epoch}>
      {children}
    </ViewStoreContext.Provider>
  );
};
