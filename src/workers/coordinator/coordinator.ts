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
import { resolvePointersToEntries } from './read/lazy-resolver.ts';

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
        watch: input.watch,
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
    case 'remote-ssh':
      return {
        kind: 'remote-ssh',
        id,
        name: input.name,
        host: input.host,
        user: input.user,
        paths: input.paths,
        keyPath: input.keyPath,
      };
    case 'cloud':
      return {
        kind: 'cloud',
        id,
        name: input.name,
        provider: input.provider,
        query: input.query,
        region: input.region,
      };
    case 'k8s':
      return {
        kind: 'k8s',
        id,
        name: input.name,
        cluster: input.cluster,
        namespace: input.namespace,
        pod: input.pod,
        container: input.container,
      };
    case 'bus':
      return {
        kind: 'bus',
        id,
        name: input.name,
        broker: input.broker,
        topic: input.topic,
        group: input.group,
      };
    case 'db':
      return {
        kind: 'db',
        id,
        name: input.name,
        dialect: input.dialect,
        url: input.url,
        query: input.query,
      };
    case 'snapshot':
      return {
        kind: 'snapshot',
        id,
        name: input.name,
        archive: input.archive,
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
    // Stub-kinds — not persisted (their adapters throw on open). If they
    // appear in indexer state from a future ADR, restore them here.
    case 'remote-ssh':
    case 'cloud':
    case 'k8s':
    case 'bus':
    case 'db':
    case 'snapshot':
      return null;
  }
};

export interface CoordinatorDeps {
  readonly parserPool: ParserPool;
  /**
   * Lazy accessor for the indexer worker. The worker + SQLite/OPFS pool are
   * not spawned until a coordinator method first calls this — see ADR-0014
   * for lifecycle invariants. The returned `proxy` and `opening` are stable
   * (memoized in `index.ts`).
   */
  readonly getIndexer: () => {
    proxy: Comlink.Remote<IndexerApi>;
    opening: Promise<OpenReport>;
  };
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
      await deps.getIndexer().opening;
      const handleStore = await deps.handleStoreOpening;
      const [indexed, handles] = await Promise.all([
        deps.getIndexer().proxy.listSources(),
        handleStore.list(),
      ]);
      const handleByIdx = new Map(handles.map((h) => [h.sourceId, h]));
      for (const rec of indexed) {
        if (sources.has(rec.id)) continue; // already live
        let logSource: LogSource | null = null;
        if (rec.kind === 'directory') {
          const persisted = handleByIdx.get(rec.id);
          if (persisted && persisted.kind === 'directory') {
            const meta = rec.metaJson
              ? (JSON.parse(rec.metaJson) as { glob?: string; watch?: boolean })
              : {};
            logSource = {
              kind: 'directory',
              id: rec.id,
              name: rec.name,
              handle: persisted.handle as FileSystemDirectoryHandle,
              glob: meta.glob,
              watch: meta.watch,
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

  /**
   * Start (or restart) ingest for a known source. Used by both `addSource` and
   * the resume/grant-permission paths — keeps the live `SourceEntry` lifecycle
   * (aborter, onStatus, onChange) in one place.
   */
  const startIngest = (source: LogSource): void => {
    const factory = deps.adapterFactories[source.kind];
    if (!factory) {
      sources.set(source.id, {
        source,
        status: {
          kind: 'error',
          error: { name: 'Error', message: `no adapter for kind '${source.kind}'` },
        },
        aborter: null,
      });
      emitStatus();
      return;
    }
    const aborter = new AbortController();
    sources.set(source.id, { source, status: { kind: 'idle' }, aborter });
    persistedRecords.delete(source.id);
    emitStatus();

    const adapter = factory(source);
    void ingestSource({
      source,
      adapter,
      parserPool: deps.parserPool,
      indexer: deps.getIndexer().proxy,
      signal: aborter.signal,
      onStatus: (status) => {
        const entry = sources.get(source.id);
        if (!entry) return;
        entry.status = status;
        emitStatus();
      },
      onChange: () => {
        emitChange();
      },
    });
  };

  /**
   * Mark a persisted source as needing user permission. The record stays in
   * `persistedRecords` (still visible in the tree) but with a status that
   * tells the UI to surface a "Grant access" affordance.
   */
  const markPermissionRequired = (source: LogSource): void => {
    persistedRecords.set(source.id, {
      source,
      status: { kind: 'permission-required' },
    });
    emitStatus();
  };

  const emitChange = (): void => {
    version++;
    if (pendingFilteredCount !== null) return; // coalesce concurrent change events
    pendingFilteredCount = (async () => {
      await deps.getIndexer().opening;
      return deps.getIndexer().proxy.count(activeFilter);
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
        deps.getIndexer().proxy.ping(),
        deps.getIndexer().opening.then(
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
      await deps.getIndexer().opening;
      if (!deps.adapterFactories[input.kind]) {
        throw new Error(
          `addSource: no adapter for source kind '${input.kind}' (probably not implemented yet)`,
        );
      }
      const id = newSourceId();
      const source = buildLogSource(input, id);

      await deps.getIndexer().proxy.upsertSource(source);

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

      startIngest(source);

      return id;
    },

    removeSource: async (id) => {
      await deps.getIndexer().opening;
      const entry = sources.get(id);
      if (entry) {
        entry.aborter?.abort();
        sources.delete(id);
      }
      persistedRecords.delete(id);
      const handleStore = await deps.handleStoreOpening;
      await Promise.all([
        deps.getIndexer().proxy.removeSource(id),
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
      await deps.getIndexer().opening;
      const pointers = await deps.getIndexer().proxy.search(
        activeFilter,
        from,
        to,
      );
      return resolvePointersToEntries(
        pointers,
        (id) => sources.get(id)?.source ?? null,
        deps.parserPool,
      );
    },

    getCount: async () => {
      await deps.getIndexer().opening;
      const [total, filtered] = await Promise.all([
        deps.getIndexer().proxy.count(EMPTY_FILTER),
        deps.getIndexer().proxy.count(activeFilter),
      ]);
      return { total, filtered };
    },

    getEntry: async (id: EntryId) => {
      await deps.getIndexer().opening;
      const ptr = await deps.getIndexer().proxy.getEntry(id);
      if (ptr === null) return null;
      const [resolved] = await resolvePointersToEntries(
        [ptr],
        (sid) => sources.get(sid)?.source ?? null,
        deps.parserPool,
      );
      return resolved ?? ptr;
    },

    getGroupCounts: async (filter, field, limit) => {
      await deps.getIndexer().opening;
      return deps.getIndexer().proxy.groupCounts(filter, field, limit);
    },

    getHistogram: async (filter, bucketCount) => {
      await deps.getIndexer().opening;
      return deps.getIndexer().proxy.histogram(filter, bucketCount);
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

    /**
     * Walk every persisted directory record, query its FS handle permission, and:
     *   - 'granted'  → start ingest immediately (`resumed`).
     *   - 'prompt'   → mark permission-required (`needsPermission`); UI surfaces
     *                  a "Grant access" button that calls `grantPermission(id)`.
     *   - 'denied'   → same as prompt — user can still re-grant via the same
     *                  button (browser will re-prompt).
     *
     * Idempotent: re-running this returns the current state. Sources already
     * live (in `sources` map) are skipped.
     */
    resumePersistedSources: async () => {
      await hydratePersisted();
      const handleStore = await deps.handleStoreOpening;
      const resumed: SourceId[] = [];
      const needsPermission: SourceId[] = [];

      for (const [id, rec] of persistedRecords) {
        if (sources.has(id)) continue;
        if (rec.source.kind !== 'directory') continue;
        const persisted = await handleStore.get(id);
        if (!persisted || persisted.kind !== 'directory') continue;

        const handle = persisted.handle as FileSystemDirectoryHandle;
        let perm: PermissionState | null = null;
        try {
          perm = (await handle.queryPermission?.({ mode: 'read' })) ?? null;
        } catch (err) {
          console.warn('[coordinator] queryPermission failed', err);
        }
        if (perm === 'granted') {
          startIngest({ ...rec.source, handle });
          resumed.push(id);
        } else {
          markPermissionRequired({ ...rec.source, handle });
          needsPermission.push(id);
        }
      }
      return { resumed, needsPermission };
    },

    /**
     * Request read permission for a previously-persisted directory and, on
     * success, restart its ingest. Must be invoked from a fresh user gesture
     * (the UI's "Grant access" click) — the browser will reject otherwise.
     */
    grantPermission: async (id) => {
      await hydratePersisted();
      const handleStore = await deps.handleStoreOpening;
      const persisted = await handleStore.get(id);
      if (!persisted || persisted.kind !== 'directory') return false;
      const handle = persisted.handle as FileSystemDirectoryHandle;

      let perm: PermissionState | undefined;
      try {
        perm = await handle.requestPermission?.({ mode: 'read' });
      } catch (err) {
        console.warn('[coordinator] requestPermission failed', err);
        return false;
      }
      if (perm !== 'granted') return false;

      const rec = persistedRecords.get(id);
      const source: LogSource =
        rec && rec.source.kind === 'directory'
          ? { ...rec.source, handle }
          : { kind: 'directory', id, name: persisted.name, handle };
      startIngest(source);
      return true;
    },

    estimateStorage: async () => {
      await deps.getIndexer().opening;
      const size = await deps.getIndexer().proxy.estimateSize();
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
      await deps.getIndexer().opening;
      for (const entry of sources.values()) {
        entry.aborter?.abort();
      }
      sources.clear();
      persistedRecords.clear();
      const handleStore = await deps.handleStoreOpening;
      await Promise.all([deps.getIndexer().proxy.clearAll(), handleStore.clearAll()]);
      emitStatus();
      emitChange();
    },

    clearSource: async (id) => {
      await deps.getIndexer().opening;
      const entry = sources.get(id);
      entry?.aborter?.abort();
      sources.delete(id);
      persistedRecords.delete(id);
      const handleStore = await deps.handleStoreOpening;
      await Promise.all([
        deps.getIndexer().proxy.removeSource(id),
        handleStore.delete(id),
      ]);
      emitStatus();
      emitChange();
    },

    exportFiltered: async (filter, format) => {
      await deps.getIndexer().opening;
      // After ADR-0016 the indexer doesn't have raw bodies anymore; the
      // export must run through the lazy resolver. We page through the
      // filtered set in chunks so we don't pull a huge result into memory.
      // 5_000 is a soft window that keeps both the SQL and the resolver
      // batches reasonable.
      const PAGE = 5000;
      const total = await deps.getIndexer().proxy.count(filter);
      const buildCsv = (await import('../../core/util/export.ts')).buildCsv;
      const buildJsonl = (await import('../../core/util/export.ts')).buildJsonl;
      const chunks: string[] = [];
      let first = true;
      for (let from = 0; from < total; from += PAGE) {
        const pointers = await deps.getIndexer().proxy.search(
          filter,
          from,
          from + PAGE,
        );
        const resolved = await resolvePointersToEntries(
          pointers,
          (id) => sources.get(id)?.source ?? null,
          deps.parserPool,
        );
        if (format === 'csv') {
          const csv = buildCsv(resolved);
          // Drop the header on every page after the first.
          chunks.push(first ? csv : csv.slice(csv.indexOf('\n') + 1));
        } else {
          chunks.push(buildJsonl(resolved));
        }
        first = false;
      }
      const text = chunks.join(format === 'csv' ? '' : '');
      const mime = format === 'csv' ? 'text/csv' : 'application/x-ndjson';
      return new Blob([text], { type: mime });
    },
    /**
     * Abort the in-flight ingest for `taskId`. We model `taskId === SourceId`
     * for now — every long-running task is an ingest pipeline tied to a
     * source. The aborter trips the adapter's stream; ingest-orchestrator
     * then surfaces a `done` (clean cancel) or `error` status. No-op for
     * unknown ids or sources without an active aborter.
     */
    cancel: async (taskId) => {
      const entry = sources.get(taskId as SourceId);
      if (!entry) return;
      entry.aborter?.abort();
    },
  };
};
