import * as Comlink from 'comlink';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { CoordinatorApi } from '../core/rpc/coordinator.contract.ts';
import type {
  EntryId,
  LogEntry,
  LogFilter,
  SourceId,
  SourceRecord,
} from '../core/types/index.ts';
import { EMPTY_FILTER } from '../core/types/index.ts';

const OVERSCAN = 200;

export interface ViewState {
  readonly filter: LogFilter;
  readonly selectedId: EntryId | null;
  readonly totalCount: number;
  readonly filteredCount: number;
  readonly sources: ReadonlyArray<SourceRecord>;
  /** sparse map: absolute index (after filter) → entry */
  readonly entries: ReadonlyMap<number, LogEntry>;
  readonly windowFrom: number;
  readonly windowTo: number;
  readonly isLoading: boolean;
  readonly version: number;
}

export interface ViewActions {
  setFilter: (next: LogFilter | ((prev: LogFilter) => LogFilter)) => void;
  resetFilter: () => void;
  selectEntry: (id: EntryId | null) => void;
  setVisibleRange: (from: number, to: number) => void;
  addFile: (file: File) => Promise<SourceId>;
  addDirectory: () => Promise<SourceId | null>;
  addText: (name: string, text: string) => Promise<SourceId>;
  addUrl: (
    url: string,
    headers?: Readonly<Record<string, string>>,
  ) => Promise<SourceId>;
  addStream: (url: string, transport?: 'ws' | 'sse') => Promise<SourceId>;
  removeSource: (id: SourceId) => Promise<void>;
  clearAll: () => Promise<void>;
  getEntry: (id: EntryId) => Promise<LogEntry | null>;
  refresh: () => Promise<void>;
  destroy: () => void;
}

export type ViewStore = StoreApi<ViewState & ViewActions>;

export const createLogClient = (): ViewStore => {
  const worker = new Worker(
    new URL('../workers/coordinator/index.ts', import.meta.url),
    { type: 'module' },
  );
  const api = Comlink.wrap<CoordinatorApi>(worker);

  let refreshToken = 0;
  let statusUnsubPromise: Promise<() => void> | null = null;
  let changeUnsubPromise: Promise<() => void> | null = null;

  const store = createStore<ViewState & ViewActions>((set, get) => {
    const refresh = async (): Promise<void> => {
      const token = ++refreshToken;
      set({ isLoading: true });
      const { filter, windowFrom, windowTo } = get();
      try {
        await api.setFilter(filter);
        const from = Math.max(0, windowFrom - OVERSCAN);
        const to = Math.max(from, windowTo + OVERSCAN);
        const [counts, range] = await Promise.all([
          api.getCount(),
          to > from
            ? api.getRange(from, to)
            : Promise.resolve([] as ReadonlyArray<LogEntry>),
        ]);
        if (token !== refreshToken) return;
        const newEntries = new Map<number, LogEntry>();
        range.forEach((e, i) => newEntries.set(from + i, e));
        set({
          totalCount: counts.total,
          filteredCount: counts.filtered,
          entries: newEntries,
          isLoading: false,
        });
      } catch (err) {
        console.error('[log-client] refresh failed', err);
        if (token === refreshToken) set({ isLoading: false });
      }
    };

    return {
      filter: EMPTY_FILTER,
      selectedId: null,
      totalCount: 0,
      filteredCount: 0,
      sources: [],
      entries: new Map(),
      windowFrom: 0,
      windowTo: 0,
      isLoading: false,
      version: 0,

      setFilter: (next) => {
        const prev = get().filter;
        const filter = typeof next === 'function' ? next(prev) : next;
        set({ filter, entries: new Map() });
        void refresh();
      },
      resetFilter: () => {
        set({ filter: EMPTY_FILTER, entries: new Map() });
        void refresh();
      },
      selectEntry: (selectedId) => set({ selectedId }),
      setVisibleRange: (from, to) => {
        const s = get();
        if (from === s.windowFrom && to === s.windowTo) return;
        set({ windowFrom: from, windowTo: to });
        void refresh();
      },
      addFile: async (file) =>
        api.addSource({
          kind: 'file',
          name: file.name,
          size: file.size,
          file,
        }),
      addDirectory: async () => {
        // Picker MUST run on main thread under user gesture.
        if (typeof window === 'undefined' || !window.showDirectoryPicker) {
          throw new Error(
            'addDirectory: File System Access API not supported in this browser',
          );
        }
        let handle: FileSystemDirectoryHandle;
        try {
          handle = await window.showDirectoryPicker({ mode: 'read' });
        } catch (err) {
          // User cancelled the picker — surface as null, not an error.
          if (err instanceof DOMException && err.name === 'AbortError') {
            return null;
          }
          throw err;
        }
        return api.addSource({
          kind: 'directory',
          name: handle.name,
          handle,
        });
      },
      addText: async (name, text) =>
        api.addSource({ kind: 'text', name, text }),
      addUrl: async (url, headers) => {
        let name = url;
        try {
          const u = new URL(url);
          const last = u.pathname.split('/').filter(Boolean).pop();
          name = last && last.length > 0 ? last : u.host;
        } catch {
          /* keep raw url as name on invalid URL */
        }
        return api.addSource({ kind: 'url', name, url, headers });
      },
      addStream: async (url, transport) => {
        const t: 'ws' | 'sse' =
          transport ??
          (url.startsWith('ws://') || url.startsWith('wss://') ? 'ws' : 'sse');
        let name = `${t}: ${url}`;
        try {
          const u = new URL(url);
          name = `${t} ${u.host}${u.pathname}`;
        } catch {
          /* keep fallback name */
        }
        return api.addSource({ kind: 'stream', name, transport: t, url });
      },
      removeSource: async (id) => {
        await api.removeSource(id);
      },
      clearAll: async () => {
        await api.clearAll();
        set({ selectedId: null, entries: new Map() });
      },
      getEntry: async (id) => api.getEntry(id),
      refresh,
      destroy: () => {
        statusUnsubPromise
          ?.then((u) => u())
          .catch(() => {
            /* ignore */
          });
        changeUnsubPromise
          ?.then((u) => u())
          .catch(() => {
            /* ignore */
          });
        worker.terminate();
      },
    };
  });

  statusUnsubPromise = api.subscribeStatus(
    Comlink.proxy((records) => {
      store.setState({ sources: records });
    }),
  );

  changeUnsubPromise = api.subscribeChanges(
    Comlink.proxy((notice) => {
      store.setState({
        version: notice.version,
        filteredCount: notice.filteredCount,
      });
      void store.getState().refresh();
    }),
  );

  // Initial fetch — pulls counts (zero) and primes filter on coordinator side.
  void store.getState().refresh();

  return store;
};
