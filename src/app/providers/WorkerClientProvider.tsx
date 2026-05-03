import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { createLogClient } from '../../worker-client/log-client.ts';
import type { ViewStore } from '../../worker-client/log-client.ts';
import { ViewStoreContext } from './view-store-context.ts';

export interface WorkerClientProviderProps {
  readonly children?: ReactNode;
}

export const WorkerClientProvider = ({ children }: WorkerClientProviderProps) => {
  const [store] = useState<ViewStore>(() => createLogClient());

  useEffect(() => {
    return () => {
      store.getState().destroy();
    };
  }, [store]);

  return <ViewStoreContext.Provider value={store}>{children}</ViewStoreContext.Provider>;
};
