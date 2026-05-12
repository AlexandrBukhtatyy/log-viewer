import * as Comlink from 'comlink';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type {
  CoordinatorApi,
  ExportFormat,
  GroupBucket,
  HistogramResponse,
  ParserInfo,
  ResumeReport,
} from '../core/rpc/coordinator.contract.ts';
import type { CustomParserDef } from '../core/parsers/custom-parser-def.ts';
import type {
  CloudProvider,
  DbDialect,
  EntryId,
  LogEntry,
  LogFilter,
  SourceId,
  SourceRecord,
} from '../core/types/index.ts';
import { EMPTY_FILTER } from '../core/types/index.ts';
import type { FieldDescriptor } from '../core/filter/field-descriptor.ts';

const OVERSCAN = 200;

export interface ViewState {
  readonly filter: LogFilter;
  readonly selectedId: EntryId | null;
  readonly totalCount: number;
  readonly filteredCount: number;
  readonly sources: ReadonlyArray<SourceRecord>;
  /**
   * `false` until the coordinator delivers its first sources snapshot
   * (after `hydratePersisted`). Lets the sidebar show a loading skeleton
   * instead of an empty list during the initial worker-open + IDB read.
   */
  readonly sourcesHydrated: boolean;
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
  addDirectory: (opts?: {
    handle?: FileSystemDirectoryHandle;
    name?: string;
    watch?: boolean;
    glob?: string;
    parserId?: string;
  }) => Promise<SourceId | null>;
  addText: (name: string, text: string) => Promise<SourceId>;
  addUrl: (
    url: string,
    headers?: Readonly<Record<string, string>>,
  ) => Promise<SourceId>;
  addStream: (url: string, transport?: 'ws' | 'sse') => Promise<SourceId>;
  // Phase 1 stub-source actions — payload reaches coordinator but the adapter
  // throws "not implemented" on open(); UI sees a `SourceStatus.kind === 'error'`
  // until each integration ADR replaces the stub. See core/sources/stub-adapters.ts.
  addRemoteSsh: (params: {
    name?: string;
    host: string;
    user?: string;
    paths?: ReadonlyArray<string>;
    keyPath?: string;
  }) => Promise<SourceId>;
  addCloud: (params: {
    name?: string;
    provider: CloudProvider;
    query?: string;
    region?: string;
  }) => Promise<SourceId>;
  addK8s: (params: {
    name?: string;
    cluster: string;
    namespace?: string;
    pod?: string;
    container?: string;
  }) => Promise<SourceId>;
  addBus: (params: {
    name?: string;
    broker: string;
    topic: string;
    group?: string;
  }) => Promise<SourceId>;
  addDb: (params: {
    name?: string;
    dialect: DbDialect;
    url: string;
    query: string;
  }) => Promise<SourceId>;
  addSnapshot: (file: File) => Promise<SourceId>;
  removeSource: (id: SourceId) => Promise<void>;
  clearAll: () => Promise<void>;
  resumePersistedSources: () => Promise<ResumeReport>;
  grantPermission: (id: SourceId) => Promise<boolean>;
  exportFiltered: (format: ExportFormat) => Promise<Blob>;
  cancelSource: (id: SourceId) => Promise<void>;
  getEntry: (id: EntryId) => Promise<LogEntry | null>;
  getGroupCounts: (
    filter: LogFilter,
    field: string,
    limit?: number,
  ) => Promise<ReadonlyArray<GroupBucket>>;
  getHistogram: (
    filter: LogFilter,
    bucketCount: number,
  ) => Promise<HistogramResponse>;
  getEntriesScoped: (
    filter: LogFilter,
    from: number,
    to: number,
  ) => Promise<ReadonlyArray<LogEntry>>;
  getFieldSchema: (filter: LogFilter) => Promise<ReadonlyArray<FieldDescriptor>>;
  listParsers: () => Promise<ReadonlyArray<ParserInfo>>;
  listCustomParsers: () => Promise<ReadonlyArray<CustomParserDef>>;
  upsertCustomParser: (def: CustomParserDef) => Promise<void>;
  removeCustomParser: (id: string) => Promise<void>;
  setSourceParser: (id: SourceId, parserId: string | null) => Promise<void>;
  refresh: () => Promise<void>;
  destroy: () => void;
}

export type ViewStore = StoreApi<ViewState & ViewActions>;

/**
 * Module-level singleton. `createLogClient` spins up a coordinator worker, an
 * indexer worker, and a parser pool — all of which take an exclusive lock on
 * the OPFS SAH-pool VFS. Calling it twice (which React 19 StrictMode does to
 * useState initializers in dev) leaves a zombie worker and turns the second
 * pool init into a `NoModificationAllowedError` cascade — symptom: RPCs from
 * the React-bound store hang because that store points at the wrong worker.
 *
 * Treat the worker pipeline as application-scoped: one per page load.
 */
let singletonStore: ViewStore | null = null;
export const getOrCreateViewStore = (): ViewStore => {
  if (singletonStore !== null) return singletonStore;
  singletonStore = createLogClient();
  return singletonStore;
};

// Vite HMR cleanup: when this module is hot-reloaded, terminate the existing
// worker pipeline so the next module instance can re-acquire OPFS SAH locks.
// Without this, an HMR-replaced module leaks a zombie worker that still holds
// the SAH lock on `/logs.sqlite`, and the new worker fails its
// `installOpfsSAHPoolVfs` with NoModificationAllowedError — manifests as an
// empty sidebar after a code edit (or a full reload that races the prior
// page's worker shutdown).
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    singletonStore?.getState().destroy();
    singletonStore = null;
  });
}

export const createLogClient = (): ViewStore => {
  // Lazy coordinator worker. We don't spawn it on store creation — the first
  // method call (typically `refresh()`) is what brings the pipeline up. This
  // matches the lifecycle invariant in ADR-0014: nothing runs until the user
  // (or an action) actually needs it. `armSubscriptions()` is invoked exactly
  // once on the first `api()` access; it kicks off the status/change
  // subscriptions and the persisted-source resume in the background, while
  // the original RPC continues unblocked.
  let coordinatorWorker: Worker | null = null;
  let coordinatorApi: Comlink.Remote<CoordinatorApi> | null = null;
  let statusUnsubPromise: Promise<() => void> | null = null;
  let changeUnsubPromise: Promise<() => void> | null = null;
  const armSubscriptions = (a: Comlink.Remote<CoordinatorApi>): void => {
    statusUnsubPromise = a.subscribeStatus(
      Comlink.proxy((records) => {
        store.setState({ sources: records, sourcesHydrated: true });
      }),
    );
    changeUnsubPromise = a.subscribeChanges(
      Comlink.proxy((notice) => {
        store.setState({
          version: notice.version,
          filteredCount: notice.filteredCount,
        });
        void store.getState().refresh();
      }),
    );
    void a.resumePersistedSources().catch((err: unknown) => {
      console.warn('[log-client] resumePersistedSources failed', err);
    });
  };
  const api = (): Comlink.Remote<CoordinatorApi> => {
    if (coordinatorApi === null) {
      coordinatorWorker = new Worker(
        new URL('../workers/coordinator/index.ts', import.meta.url),
        { type: 'module' },
      );
      coordinatorApi = Comlink.wrap<CoordinatorApi>(coordinatorWorker);
      armSubscriptions(coordinatorApi);
    }
    return coordinatorApi;
  };

  let refreshToken = 0;

  const store = createStore<ViewState & ViewActions>((set, get) => {
    const refresh = async (): Promise<void> => {
      const token = ++refreshToken;
      set({ isLoading: true });
      const { filter, windowFrom, windowTo } = get();
      try {
        await api().setFilter(filter);
        const from = Math.max(0, windowFrom - OVERSCAN);
        const to = Math.max(from, windowTo + OVERSCAN);
        const [counts, range] = await Promise.all([
          api().getCount(),
          to > from
            ? api().getRange(from, to)
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
      sourcesHydrated: false,
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
        api().addSource({
          kind: 'file',
          name: file.name,
          size: file.size,
          file,
        }),
      addDirectory: async (opts) => {
        let handle = opts?.handle ?? null;
        if (handle === null) {
          // Picker MUST run on main thread under user gesture.
          if (typeof window === 'undefined' || !window.showDirectoryPicker) {
            throw new Error(
              'addDirectory: File System Access API not supported in this browser',
            );
          }
          try {
            handle = await window.showDirectoryPicker({ mode: 'read' });
          } catch (err) {
            // User cancelled the picker — surface as null, not an error.
            if (err instanceof DOMException && err.name === 'AbortError') {
              return null;
            }
            throw err;
          }
        }
        return api().addSource({
          kind: 'directory',
          name: opts?.name ?? handle.name,
          handle,
          glob: opts?.glob,
          watch: opts?.watch,
          parserId: opts?.parserId,
        });
      },
      addText: async (name, text) =>
        api().addSource({ kind: 'text', name, text }),
      addUrl: async (url, headers) => {
        let name = url;
        try {
          const u = new URL(url);
          const last = u.pathname.split('/').filter(Boolean).pop();
          name = last && last.length > 0 ? last : u.host;
        } catch {
          /* keep raw url as name on invalid URL */
        }
        return api().addSource({ kind: 'url', name, url, headers });
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
        return api().addSource({ kind: 'stream', name, transport: t, url });
      },
      addRemoteSsh: async ({ name, host, user, paths, keyPath }) =>
        api().addSource({
          kind: 'remote-ssh',
          name: name ?? (user ? `${user}@${host}` : host),
          host,
          user,
          paths,
          keyPath,
        }),
      addCloud: async ({ name, provider, query, region }) =>
        api().addSource({
          kind: 'cloud',
          name: name ?? `${provider}${region ? ' · ' + region : ''}`,
          provider,
          query,
          region,
        }),
      addK8s: async ({ name, cluster, namespace, pod, container }) =>
        api().addSource({
          kind: 'k8s',
          name: name ?? `k8s · ${cluster}${namespace ? '/' + namespace : ''}`,
          cluster,
          namespace,
          pod,
          container,
        }),
      addBus: async ({ name, broker, topic, group }) =>
        api().addSource({
          kind: 'bus',
          name: name ?? `${broker} · ${topic}`,
          broker,
          topic,
          group,
        }),
      addDb: async ({ name, dialect, url, query }) =>
        api().addSource({
          kind: 'db',
          name: name ?? `${dialect} · ${url}`,
          dialect,
          url,
          query,
        }),
      addSnapshot: async (file) =>
        api().addSource({ kind: 'snapshot', name: file.name, archive: file }),
      removeSource: async (id) => {
        await api().removeSource(id);
      },
      clearAll: async () => {
        await api().clearAll();
        set({ selectedId: null, entries: new Map() });
      },
      resumePersistedSources: async () => api().resumePersistedSources(),
      grantPermission: async (id) => api().grantPermission(id),
      exportFiltered: async (format) => api().exportFiltered(get().filter, format),
      cancelSource: async (id) => api().cancel(id as string),
      getEntry: async (id) => api().getEntry(id),
      getGroupCounts: async (filter, field, limit) =>
        api().getGroupCounts(filter, field, limit),
      getHistogram: async (filter, bucketCount) =>
        api().getHistogram(filter, bucketCount),
      getEntriesScoped: async (filter, from, to) =>
        api().getEntriesScoped(filter, from, to),
      getFieldSchema: async (filter) => api().getFieldSchema(filter),
      listParsers: async () => api().listParsers(),
      listCustomParsers: async () => api().listCustomParsers(),
      upsertCustomParser: async (def) => api().upsertCustomParser(def),
      removeCustomParser: async (id) => api().removeCustomParser(id),
      setSourceParser: async (id, parserId) => api().setSourceParser(id, parserId),
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
        coordinatorWorker?.terminate();
      },
    };
  });

  return store;
};
