import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const MAX_RECENT = 10;

interface SearchHistoryState {
  /** Most-recent-first list of submitted free-text queries. */
  recent: string[];
  /** Record a submitted query: dedupes (case-sensitive), moves to front,
   *  drops blanks, caps the list at MAX_RECENT. */
  push(query: string): void;
  clear(): void;
}

/**
 * Recent free-text search queries, persisted like the other `lv:`-prefixed
 * stores. Powers the "Recent" group of the search autocomplete. Saved
 * searches live in `use-saved-searches`; this is the lightweight history.
 */
export const useSearchHistory = create<SearchHistoryState>()(
  persist(
    (set, get) => ({
      recent: [],
      push: (query) => {
        const q = query.trim();
        if (q === '') return;
        const next = [q, ...get().recent.filter((r) => r !== q)].slice(
          0,
          MAX_RECENT,
        );
        set({ recent: next });
      },
      clear: () => set({ recent: [] }),
    }),
    { name: 'lv:search-history' },
  ),
);
