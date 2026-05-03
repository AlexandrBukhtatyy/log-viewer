import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import { useViewStore } from '../app/providers/view-store-context.ts';
import type { EntryId, LogEntry } from '../core/types/index.ts';

export interface UseSelectedEntry {
  readonly selectedId: EntryId | null;
  readonly selected: LogEntry | null;
  select: (id: EntryId | null) => void;
}

/**
 * Resolves the selected entry on demand. Synchronous for the in-viewport-cache
 * case; async fetch via the worker for entries outside the cached window.
 *
 * The async result is matched against current selectedId on read, so a stale
 * fetch result for a previous selection never surfaces in the UI.
 */
export const useSelectedEntry = (): UseSelectedEntry => {
  const store = useViewStore();
  const selectedId = useStore(store, (s) => s.selectedId);
  const cachedEntry = useStore(store, (s) =>
    s.selectedId === null
      ? null
      : ([...s.entries.values()].find((e) => e.id === s.selectedId) ?? null),
  );

  const [asyncResolved, setAsyncResolved] = useState<LogEntry | null>(null);

  useEffect(() => {
    // Synchronous cases — no fetch needed (and no setState in effect body).
    if (selectedId === null) return;
    if (cachedEntry !== null) return;

    let cancelled = false;
    void store
      .getState()
      .getEntry(selectedId)
      .then((entry) => {
        if (!cancelled) setAsyncResolved(entry);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, cachedEntry, store]);

  // Derive resolved value synchronously; ignore stale asyncResolved if it
  // doesn't match the current selectedId.
  const resolved = useMemo<LogEntry | null>(() => {
    if (selectedId === null) return null;
    if (cachedEntry !== null && cachedEntry.id === selectedId) return cachedEntry;
    if (asyncResolved !== null && asyncResolved.id === selectedId) return asyncResolved;
    return null;
  }, [selectedId, cachedEntry, asyncResolved]);

  const select = useCallback(
    (id: EntryId | null) => store.getState().selectEntry(id),
    [store],
  );

  return {
    selectedId,
    selected: resolved,
    select,
  };
};
