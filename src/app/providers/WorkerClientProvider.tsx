import { useState } from 'react';
import type { ReactNode } from 'react';
import { getOrCreateViewStore } from '../../worker-client/log-client.ts';
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
 */
export const WorkerClientProvider = ({ children }: WorkerClientProviderProps) => {
  const [store] = useState<ViewStore>(() => getOrCreateViewStore());

  return <ViewStoreContext.Provider value={store}>{children}</ViewStoreContext.Provider>;
};
