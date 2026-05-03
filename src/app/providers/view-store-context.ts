import { createContext, useContext } from 'react';
import type { ViewStore } from '../../worker-client/log-client.ts';

export const ViewStoreContext = createContext<ViewStore | null>(null);

export const useViewStore = (): ViewStore => {
  const store = useContext(ViewStoreContext);
  if (store === null) {
    throw new Error(
      'useViewStore must be used inside <WorkerClientProvider> — see ADR-0007 / ADR-0009.',
    );
  }
  return store;
};
