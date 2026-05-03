import { useCallback } from 'react';
import { useStore } from 'zustand';
import { useViewStore } from '../app/providers/view-store-context.ts';
import type { LogEntry } from '../core/types/index.ts';

export interface UseLogWindow {
  readonly totalCount: number;
  readonly filteredCount: number;
  readonly isLoading: boolean;
  readonly version: number;
  /** Returns entry at absolute (post-filter) index, or undefined if not yet loaded. */
  getRow: (index: number) => LogEntry | undefined;
  setVisibleRange: (from: number, to: number) => void;
}

export const useLogWindow = (): UseLogWindow => {
  const store = useViewStore();

  const totalCount = useStore(store, (s) => s.totalCount);
  const filteredCount = useStore(store, (s) => s.filteredCount);
  const isLoading = useStore(store, (s) => s.isLoading);
  const version = useStore(store, (s) => s.version);
  // Subscribe to entries map so virtualizer re-renders when window updates.
  const entries = useStore(store, (s) => s.entries);

  const getRow = useCallback(
    (index: number) => entries.get(index),
    [entries],
  );

  const setVisibleRange = useCallback(
    (from: number, to: number) => store.getState().setVisibleRange(from, to),
    [store],
  );

  return {
    totalCount,
    filteredCount,
    isLoading,
    version,
    getRow,
    setVisibleRange,
  };
};
