import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const LIMIT = 10;

export interface RecentFile {
  id: string;
  name: string;
  path?: string;
  /** Last-accessed epoch ms — newest first. */
  lastAccessed: number;
}

interface RecentFilesState {
  list: RecentFile[];
  /** Mark a file as accessed; moves it to the top of the list. */
  touch(file: { id: string; name: string; path?: string }): void;
  remove(id: string): void;
  clear(): void;
}

export const useRecentFiles = create<RecentFilesState>()(
  persist(
    (set, get) => ({
      list: [],
      touch: (file) => {
        const now = Date.now();
        const cur = get().list.filter((r) => r.id !== file.id);
        cur.unshift({ ...file, lastAccessed: now });
        set({ list: cur.slice(0, LIMIT) });
      },
      remove: (id) => set({ list: get().list.filter((r) => r.id !== id) }),
      clear: () => set({ list: [] }),
    }),
    { name: 'lv:recent-files' },
  ),
);
