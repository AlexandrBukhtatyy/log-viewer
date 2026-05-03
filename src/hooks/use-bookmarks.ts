import { useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { EntryId } from '../core/types/index.ts';

interface BookmarksState {
  // Internally a string array — Set is not natively JSON-serializable.
  ids: string[];
  toggle(id: EntryId): void;
  remove(id: EntryId): void;
  clear(): void;
}

const useBookmarksStore = create<BookmarksState>()(
  persist(
    (set, get) => ({
      ids: [],
      toggle: (id) => {
        const cur = get().ids;
        set({ ids: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
      },
      remove: (id) => set({ ids: get().ids.filter((x) => x !== id) }),
      clear: () => set({ ids: [] }),
    }),
    { name: 'lv:bookmarks' },
  ),
);

export interface UseBookmarks {
  readonly ids: ReadonlySet<EntryId>;
  toggle(id: EntryId): void;
  remove(id: EntryId): void;
  clear(): void;
}

/**
 * Bookmarked `EntryId`s with `localStorage`-persistence. Caveat: `EntryId`
 * is not stable across source reloads (a re-ingest assigns fresh ids); the
 * Phase-4 plan replaces these with `{sourceId, seq}` fingerprints.
 */
export const useBookmarks = (): UseBookmarks => {
  const ids = useBookmarksStore((s) => s.ids);
  const toggle = useBookmarksStore((s) => s.toggle);
  const remove = useBookmarksStore((s) => s.remove);
  const clear = useBookmarksStore((s) => s.clear);
  const idSet = useMemo(
    () => new Set(ids as unknown as ReadonlyArray<EntryId>) as ReadonlySet<EntryId>,
    [ids],
  );
  return { ids: idSet, toggle, remove, clear };
};
