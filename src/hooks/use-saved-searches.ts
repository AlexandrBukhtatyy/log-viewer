import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { LogLevel } from '../core/types/index.ts';

export interface LvSavedSearch {
  id: string;
  name: string;
  query: string;
  levels: LogLevel[];
}

interface SavedSearchesState {
  list: LvSavedSearch[];
  add(search: LvSavedSearch): void;
  remove(id: string): void;
  rename(id: string, name: string): void;
  clear(): void;
}

export const useSavedSearches = create<SavedSearchesState>()(
  persist(
    (set, get) => ({
      list: [],
      add: (search) => set({ list: [...get().list, search] }),
      remove: (id) => set({ list: get().list.filter((s) => s.id !== id) }),
      rename: (id, name) =>
        set({
          list: get().list.map((s) => (s.id === id ? { ...s, name } : s)),
        }),
      clear: () => set({ list: [] }),
    }),
    { name: 'lv:saved-searches' },
  ),
);
