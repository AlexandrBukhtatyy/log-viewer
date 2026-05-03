import * as Comlink from 'comlink';
import type {
  ChangesNotice,
  CoordinatorApi,
} from '../../core/rpc/coordinator.contract.ts';
import type {
  IndexedSourceRecord,
  IndexerApi,
  OpenReport,
} from '../../core/rpc/indexer.contract.ts';
import type { LogSourceAdapterFactory } from '../../core/sources/source-adapter.ts';
import type {
  EntryId,
  LogFilter,
  LogSource,
  LogSourceInput,
  LogSourceKind,
  SourceId,
  SourceRecord,
  SourceStatus,
} from '../../core/types/index.ts';
import { EMPTY_FILTER } from '../../core/types/index.ts';
import { newSourceId } from '../../core/util/ids.ts';
import type { HandleStore } from './handles/handle-store.ts';
import { ingestSource } from './ingest/ingest-orchestrator.ts';
import type { ParserPool } from './pool/parser-pool.ts';

const WORKER_ID = crypto.randomUUID();

const notImplemented = (name: string): never => {
  throw new Error(`coordinator.${name}: not implemented yet (worker ${WORKER_ID})`);
};

interface SourceEntry {
  source: LogSource;
  status: SourceStatus;
  aborter: AbortController | null;
}

const buildLogSource = (input: LogSourceInput, id: SourceId): LogSource => {
  switch (input.kind) {
    case 'file':
      return { kind: 'file', id, name: input.name, size: input.size, file: input.file };
    case 'directory':
      return {
        kind: 'directory',
        id,
        name: input.name,
        handle: input.handle,
        glob: input.glob,
      };
    case 'text':
      return { kind: 'text', id, name: input.name, text: input.text };
    case 'url':
      return {
        kind: 'url',
        id,
        name: input.name,
        url: input.url,
        headers: input.headers,
      };
    case 'stream':
      return {
        kind: 'stream',
        id,
        name: input.name,
        transport: input.transport,
        url: input.url,
      };
  }
};

/**
 * Restore a placeholder LogSource from indexed metadata after reload, for source
 * kinds that don't depend on a persisted handle.
 *
 * `file` is intentionally not restored — single-file picks don't go to the
 * handle store; the entries persist in OPFS but the source chip won't reappear.
 * `directory` is restored from handle store separately (see listSources).
 */
const placeholderFromIndexed = (rec: IndexedSourceRecord): LogSource | null => {
  switch (rec.kind) {
    case 'file':
    case 'directory':
      return null;
    case 'text':
      return { kind: 'text', id: rec.id, name: rec.name, text: '' };
    case 'url': {
      const meta = rec.metaJson ? (JSON.parse(rec.metaJson) as { url?: string }) : {};
      return {
        kind: 'url',
        id: rec.id,
        name: rec.name,
        url: typeof meta.url === 'string' ? meta.url : '',
      };
    }
    case 'stream': {
      const meta = rec.metaJson
        ? (JSON.parse(rec.metaJson) as { transport?: 'ws' | 'sse'; url?: string })
        : {};
      return {
        kind: 'stream',
        id: rec.id,
        name: rec.name,
        transport: meta.transport ?? 'ws',
        url: typeof meta.url === 'string' ? meta.url : '',
      };
    }
  }
};

export interface CoordinatorDeps {
  readonly parserPool: ParserPool;
  readonly indexer: Comlink.Remote<IndexerApi>;
  readonly indexerOpening: Promise<OpenReport>;
  readonly adapterFactories: Partial<Record<LogSourceKind, LogSourceAdapterFactory>>;
  /** Awaited inside methods that touch handles; keeps Comlink.expose synchronous. */
  readonly handleStoreOpening: Promise<HandleStore>;
}

export const createCoordinatorApi = (deps: CoordinatorDeps): CoordinatorApi => {
  const sources = new Map<SourceId, SourceEntry>();
  /** Sources that are persisted but not currently live (after reload, until removeSource). */
  const persistedRecords = new Map<SourceId, SourceRecord>();
  let persistedHydrationPromise: Promise<void> | null = null;
  const statusListeners = new Set<(records: ReadonlyArray<SourceRecord>) => void>();
  const changeListeners = new Set<(notice: ChangesNotice) => void>();

  const hydratePersisted = async (): Promise<void> => {
    if (persistedHydrationPromise !== null) return persistedHydrationPromise;
    persistedHydrationPromise = (async () => {
      await deps.indexerOpening;
      const handleStore = await deps.handleStoreOpening;
      const [indexed, handles] = await Promise.all([
        deps.indexer.listSources(),
        handleStore.list(),
      ]);
      const handleByIdx = new Map(handles.map((h) => [h.sourceId, h]));
      for (const rec of indexed) {
        if (sources.has(rec.id)) continue; // already live
        let logSource: LogSource | null = null;
        if (rec.kind === 'directory') {
          const persisted = handleByIdx.get(rec.id);
          if (persisted && persisted.kind === 'directory') {
            logSource = {
              kind: 'directory',
              id: rec.id,
              name: rec.name,
              handle: persisted.handle as FileSystemDirectoryHandle,
            };
          }
        } else {
          logSource = placeholderFromIndexed(rec);
        }
        if (logSource === null) continue;
        persistedRecords.set(rec.id, {
          source: logSource,
          status: { kind: 'done', entryCount: rec.entryCount },
        });
      }
    })();
    return persistedHydrationPromise;
  };
  // Kick off hydration eagerly — emitStatus benefits from it being ready, but it's not awaited there.
  void hydratePersisted();

  let activeFilter: LogFilter = EMPTY_FILTER;
  let version = 0;
  let pendingFilteredCount: Promise<number> | null = null;

  const snapshotSources = (): SourceRecord[] => {
    const result: SourceRecord[] = [];
    for (const e of sources.values()) {
      result.push({ source: e.source, status: e.status });
    }
    for (const [id, rec] of persistedRecords) {
      if (sources.has(id)) continue; // live takes precedence
      result.push(rec);
    }
    return result;
  };

  const emitStatus = (): void => {
    const snap = snapshotSources();
    for (const cb of statusListeners) {
      void cb(snap);
    }
  };

  const emitChange = (): void => {
    version++;
    if (pendingFilteredCount !== null) return; // coalesce concurrent change events
    pendingFilteredCount = (async () => {
      await deps.indexerOpening;
      return deps.indexer.count(activeFilter);
    })();
    pendingFilteredCount
      .then((filteredCount) => {
        const notice: ChangesNotice = { version, filteredCount };
        for (const cb of changeListeners) {
          void cb(notice);
        }
      })
      .catch((err: unknown) => {
        console.error('[coordinator] count failed during change notify', err);
      })
      .finally(() => {
        pendingFilteredCount = null;
      });
  };

  return {
    ping: async () => {
      const me = `coordinator:${WORKER_ID}`;
      const [parsers, indexerPing, db] = await Promise.all([
        deps.parserPool.pingAll(),
        deps.indexer.ping(),
        deps.indexerOpening.then(
          (r) => ({ ok: true as const, ...r }),
          (e: unknown) => ({
            ok: false as const,
            error: e instanceof Error ? e.message : String(e),
          }),
        ),
      ]);
      return JSON.stringify(
        {
          coordinator: me,
          parsers,
          indexer: indexerPing,
          db,
          poolSize: deps.parserPool.size,
        },
        null,
        2,
      );
    },

    addSource: async (input) => {
      await deps.indexerOpening;
      const factory = deps.adapterFactories[input.kind];
      if (!factory) {
        throw new Error(
          `addSource: no adapter for source kind '${input.kind}' (probably not implemented yet)`,
        );
      }
      const id = newSourceId();
      const source = buildLogSource(input, id);
      const aborter = new AbortController();
      sources.set(id, { source, status: { kind: 'idle' }, aborter });
      persistedRecords.delete(id); // live takes over if same id

      await deps.indexer.upsertSource(source);

      // Persist handle for sources that can be revived after reload.
      if (source.kind === 'directory') {
        const handleStore = await deps.handleStoreOpening;
        await handleStore.put({
          sourceId: id,
          kind: 'directory',
          name: source.name,
          handle: source.handle,
          createdAt: Date.now(),
        });
      }

      emitStatus();

      const adapter = factory(source);

      // Fire-and-forget; ingest emits its own status updates and change events.
      void ingestSource({
        source,
        adapter,
        parserPool: deps.parserPool,
        indexer: deps.indexer,
        signal: aborter.signal,
        onStatus: (status) => {
          const entry = sources.get(id);
          if (!entry) return;
          entry.status = status;
          emitStatus();
        },
        onChange: () => {
          emitChange();
        },
      });

      return id;
    },

    removeSource: async (id) => {
      await deps.indexerOpening;
      const entry = sources.get(id);
      if (entry) {
        entry.aborter?.abort();
        sources.delete(id);
      }
      persistedRecords.delete(id);
      const handleStore = await deps.handleStoreOpening;
      await Promise.all([
        deps.indexer.removeSource(id),
        handleStore.delete(id),
      ]);
      emitStatus();
      emitChange();
    },

    reIndex: async () => notImplemented('reIndex'),

    setFilter: async (filter) => {
      // Filter is a query parameter on the main thread — not a data change.
      // We do NOT emitChange here, otherwise the main thread (which subscribes
      // to changes) will trigger another refresh that calls setFilter again,
      // creating an infinite loop. Main thread is responsible for re-fetching
      // counts/range after it changes the filter.
      activeFilter = filter;
    },
    getFilter: async () => activeFilter,

    getRange: async (from, to) => {
      await deps.indexerOpening;
      return deps.indexer.search(activeFilter, from, to);
    },

    getCount: async () => {
      await deps.indexerOpening;
      const [total, filtered] = await Promise.all([
        deps.indexer.count(EMPTY_FILTER),
        deps.indexer.count(activeFilter),
      ]);
      return { total, filtered };
    },

    getEntry: async (id: EntryId) => {
      await deps.indexerOpening;
      return deps.indexer.getEntry(id);
    },

    listSources: async () => {
      await hydratePersisted();
      return snapshotSources();
    },

    subscribeStatus: async (cb) => {
      statusListeners.add(cb);
      // Wait for hydration so the initial snapshot includes persisted directory chips.
      await hydratePersisted();
      void cb(snapshotSources());
      return Comlink.proxy(() => {
        statusListeners.delete(cb);
      });
    },

    subscribeChanges: async (cb) => {
      changeListeners.add(cb);
      return Comlink.proxy(() => {
        changeListeners.delete(cb);
      });
    },

    resumePersistedSources: async () => notImplemented('resumePersistedSources'),
    grantPermission: async () => notImplemented('grantPermission'),

    estimateStorage: async () => {
      await deps.indexerOpening;
      const size = await deps.indexer.estimateSize();
      let quota = 0;
      try {
        const est = await navigator.storage?.estimate?.();
        quota = est?.quota ?? 0;
      } catch {
        /* not supported */
      }
      return {
        used: size.total,
        quota,
        perSource: size.perSource,
      };
    },

    clearAll: async () => {
      await deps.indexerOpening;
      for (const entry of sources.values()) {
        entry.aborter?.abort();
      }
      sources.clear();
      persistedRecords.clear();
      const handleStore = await deps.handleStoreOpening;
      await Promise.all([deps.indexer.clearAll(), handleStore.clearAll()]);
      emitStatus();
      emitChange();
    },

    clearSource: async (id) => {
      await deps.indexerOpening;
      const entry = sources.get(id);
      entry?.aborter?.abort();
      sources.delete(id);
      persistedRecords.delete(id);
      const handleStore = await deps.handleStoreOpening;
      await Promise.all([
        deps.indexer.removeSource(id),
        handleStore.delete(id),
      ]);
      emitStatus();
      emitChange();
    },

    exportFiltered: async () => notImplemented('exportFiltered'),
    cancel: async () => notImplemented('cancel'),
  };
};
