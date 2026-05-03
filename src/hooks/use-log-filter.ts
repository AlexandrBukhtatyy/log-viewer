import { useCallback } from 'react';
import { useStore } from 'zustand';
import { useViewStore } from '../app/providers/view-store-context.ts';
import type { LogFilter } from '../core/types/index.ts';

export interface UseLogFilter {
  readonly filter: LogFilter;
  setFilter: (next: LogFilter | ((prev: LogFilter) => LogFilter)) => void;
  resetFilter: () => void;
}

export const useLogFilter = (): UseLogFilter => {
  const store = useViewStore();
  const filter = useStore(store, (s) => s.filter);

  const setFilter = useCallback(
    (next: LogFilter | ((prev: LogFilter) => LogFilter)) =>
      store.getState().setFilter(next),
    [store],
  );

  const resetFilter = useCallback(
    () => store.getState().resetFilter(),
    [store],
  );

  return { filter, setFilter, resetFilter };
};
