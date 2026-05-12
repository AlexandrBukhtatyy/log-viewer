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
  LogEntry,
  LogFilter,
  LogSource,
  LogSourceInput,
  LogSourceKind,
  SourceId,
  SourceRecord,
  SourceStatus,
} from '../../core/types/index.ts';
import { EMPTY_FILTER } from '../../core/types/index.ts';
import { BUILT_IN_FIELD_DESCRIPTORS } from '../../core/filter/field-descriptor.ts';
import {
  compileFreeTextQuery,
  matchesFreeText,
  type CompiledQuery,
} from '../../core/filter/query-match.ts';
import { newSourceId } from '../../core/util/ids.ts';
import type { CustomParserDef } from '../../core/parsers/custom-parser-def.ts';
import { removeSpool } from '../../core/storage/opfs-spool.ts';
import type { CustomParserStore } from './custom-parsers/store.ts';
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
  /** Parser id resolved at ingest time. Populated by orchestrator's onParserDetected callback. */
  parserId?: string;
  /** Parser's `defaultColumns` snapshot — propagated to `SourceRecord` so UI can auto-apply once. */
  parserDefaultColumns?: ReadonlyArray<string>;
}

const buildLogSource = (input: LogSourceInput, id: SourceId): LogSource => {
  // `parserId` only applies to the kinds whose ingestion goes through
  // the parser pool (file/directory/text/url/stream). Stub kinds
  // — remote-ssh/cloud/k8s/bus/db/snapshot — never reach the parser
  // selection step, so we don't bother carrying the override.
  switch (input.kind) {
    case 'file':
      return {
        kind: 'file',
        id,
        name: input.name,
        size: input.size,
        file: input.file,
        parserId: input.parserId,
      };
    case 'directory':
      return {
        kind: 'directory',
        id,
        name: input.name,
        handle: input.handle,
        glob: input.glob,
        watch: input.watch,
        parserId: input.parserId,
      };
    case 'text':
      return {
        kind: 'text',
        id,
        name: input.name,
        text: input.text,
        parserId: input.parserId,
      };
    case 'url':
      return {
        kind: 'url',
        id,
        name: input.name,
        url: input.url,
        headers: input.headers,
        parserId: input.parserId,
      };
    case 'stream':
      return {
        kind: 'stream',
        id,
        name: input.name,
        transport: input.transport,
        url: input.url,
        parserId: input.parserId,
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
 * `file` is rebuilt as a stub `LogSource` (empty `File`) — the source chip
 * shows up in the sidebar so the user can still browse the previously
 * indexed entries via the OPFS spool. The stub is never re-ingested; if
 * the user wants fresh data they re-pick the file.
 * `directory` is restored from handle store separately (see listSources).
 */
const placeholderFromIndexed = (rec: IndexedSourceRecord): LogSource | null => {
  switch (rec.kind) {
    case 'file': {
      const meta = rec.metaJson
        ? (JSON.parse(rec.metaJson) as { size?: number; parserId?: string })
        : {};
      return {
        kind: 'file',
        id: rec.id,
        name: rec.name,
        size: typeof meta.size === 'number' ? meta.size : 0,
        // Stub File — only used when the resolver looks up the source
        // for byte-range reads, which actually goes through the OPFS
        // spool, not this object.
        file: new File([], rec.name),
        parserId: meta.parserId,
      };
    }
    case 'directory':
      return null;
    case 'text': {
      const meta = rec.metaJson
        ? (JSON.parse(rec.metaJson) as { parserId?: string })
        : {};
      return {
        kind: 'text',
        id: rec.id,
        name: rec.name,
        text: '',
        parserId: meta.parserId,
      };
    }
    case 'url': {
      const meta = rec.metaJson
        ? (JSON.parse(rec.metaJson) as { url?: string; parserId?: string })
        : {};
      return {
        kind: 'url',
        id: rec.id,
        name: rec.name,
        url: typeof meta.url === 'string' ? meta.url : '',
        parserId: meta.parserId,
      };
    }
    case 'stream': {
      const meta = rec.metaJson
        ? (JSON.parse(rec.metaJson) as {
            transport?: 'ws' | 'sse';
            url?: string;
            parserId?: string;
          })
        : {};
      return {
        kind: 'stream',
        id: rec.id,
        name: rec.name,
        transport: meta.transport ?? 'ws',
        url: typeof meta.url === 'string' ? meta.url : '',
        parserId: meta.parserId,
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
  /** Per-workspace user-defined parser store (Phase 2.C). */
  readonly customParserStoreOpening: Promise<CustomParserStore>;
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
      let succeeded = false;
      try {
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
                ? (JSON.parse(rec.metaJson) as {
                    glob?: string;
                    watch?: boolean;
                    parserId?: string;
                  })
                : {};
              logSource = {
                kind: 'directory',
                id: rec.id,
                name: rec.name,
                handle: persisted.handle as FileSystemDirectoryHandle,
                glob: meta.glob,
                watch: meta.watch,
                parserId: meta.parserId,
              };
            }
          } else {
            logSource = placeholderFromIndexed(rec);
          }
          if (logSource === null) continue;
          // Source.parserId (when present) was stored in meta_json by
          // `serializeSourceMeta`; surface it on the SourceRecord so
          // the parser badge in the sidebar and `@parser.id` in Meta
          // tab survive reload.
          const persistedParserId =
            'parserId' in logSource ? logSource.parserId : undefined;
          persistedRecords.set(rec.id, {
            source: logSource,
            status: { kind: 'done', entryCount: rec.entryCount },
            parserId: persistedParserId,
          });
        }
        succeeded = true;
      } catch (err) {
        console.warn(
          '[coordinator] hydratePersisted failed; will retry on next call',
          err,
        );
      }
      // Re-emit so any subscriber that already received an empty
      // snapshot now sees the persisted chips appear.
      emitStatus();
      // On failure, drop the cached promise so a follow-up call (e.g.
      // resumePersistedSources, listSources, or grantPermission) can
      // retry — otherwise a transient indexer-open failure would lock
      // the sidebar in an empty state for the rest of the session.
      if (!succeeded) persistedHydrationPromise = null;
    })();
    return persistedHydrationPromise;
  };
  // Kick off hydration eagerly — emitStatus benefits from it being ready, but it's not awaited there.
  void hydratePersisted();

  // Eagerly load user-defined parsers (Phase 2.C). The pool remembers
  // the list and replays it on every spawned worker; failures here
  // are surfaced via console but never block the rest of startup.
  void (async () => {
    try {
      const store = await deps.customParserStoreOpening;
      const defs = await store.list();
      if (defs.length > 0) {
        await deps.parserPool.loadCustomParsers(defs);
      }
    } catch (err) {
      console.warn('[coordinator] custom-parser hydration failed', err);
    }
  })();

  let activeFilter: LogFilter = EMPTY_FILTER;
  let version = 0;
  let pendingFilteredCount: Promise<number> | null = null;

  // Slow-path cache for free-text query (Phase 1.1 of the multi-format
  // roadmap). Each entry of this cache holds the array of *resolved*
  // matching entries for a given (filter+version) tuple, so paging
  // through the result via repeated `getRange` calls doesn't re-scan
  // every batch. Invalidated whenever the user filter or the underlying
  // entry set changes.
  let freeTextCache: {
    readonly sig: string;
    readonly matches: ReadonlyArray<LogEntry>;
  } | null = null;
  const invalidateFreeTextCache = (): void => {
    freeTextCache = null;
  };

  // Batch size for the slow-path scanner. Pointers are pulled from the
  // indexer in chunks of this size, each chunk goes through the lazy
  // resolver (one parser-pool RPC per source), and matches are kept.
  // Tuned to balance round-trip latency against memory pressure.
  const FREE_TEXT_BATCH = 500;

  const ensureFreeTextMatches = async (
    filter: LogFilter,
    compiled: CompiledQuery,
  ): Promise<ReadonlyArray<LogEntry>> => {
    // Cache key includes the version counter so any ingest that adds
    // rows blows the cache automatically — the same `filter` object
    // shape could otherwise alias a stale result.
    const sig = JSON.stringify({ filter, mode: compiled.mode, v: version });
    if (freeTextCache !== null && freeTextCache.sig === sig) {
      return freeTextCache.matches;
    }
    const matches: LogEntry[] = [];
    let offset = 0;
    while (true) {
      const pointers = await deps.getIndexer().proxy.search(
        filter,
        offset,
        offset + FREE_TEXT_BATCH,
      );
      if (pointers.length === 0) break;
      const resolved = await resolvePointersToEntries(
        pointers,
        (id) => sources.get(id)?.source ?? null,
        deps.parserPool,
      );
      for (const e of resolved) {
        if (matchesFreeText(e, compiled)) matches.push(e);
      }
      offset += pointers.length;
      if (pointers.length < FREE_TEXT_BATCH) break;
    }
    freeTextCache = { sig, matches };
    return matches;
  };

  const snapshotSources = (): SourceRecord[] => {
    const result: SourceRecord[] = [];
    for (const e of sources.values()) {
      result.push({
        source: e.source,
        status: e.status,
        parserId: e.parserId,
        parserDefaultColumns: e.parserDefaultColumns,
      });
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
      onParserDetected: ({ parserId, defaultColumns }) => {
        const entry = sources.get(source.id);
        if (!entry) return;
        entry.parserId = parserId;
        entry.parserDefaultColumns = defaultColumns;
        // Status snapshot now carries the parser metadata — UI picks
        // it up through the existing subscribeStatus callback without
        // a separate channel.
        emitStatus();
      },
    });
  };

  /**
   * Wipe everything we've indexed/spooled for `id` and restart ingest with
   * the (possibly updated) source object. Used when:
   *   - User edits/deletes a custom parser → sources pinned to that id
   *     must be re-parsed so the new compiled regex applies retroactively.
   *   - User explicitly changes a source's `parserId` via `setSourceParser`.
   *
   * Only operates on currently-live sources (those in the `sources` map).
   * Persisted-only records (after reload, before user resumes them) keep
   * their `parserId` in `metaJson`; the new parser kicks in when the user
   * eventually triggers ingest. File/text/url/stream stubs that exist only
   * because of `placeholderFromIndexed` cannot be re-ingested — their
   * payload is gone — so we silently skip them.
   */
  const reIngestSource = async (newSource: LogSource): Promise<void> => {
    const live = sources.get(newSource.id);
    if (!live) return;
    live.aborter?.abort();
    try {
      await deps.getIndexer().proxy.removeSource(newSource.id);
    } catch (err) {
      console.warn('[coordinator] reIngestSource: removeSource failed', err);
    }
    // Cascade-deletes inside SQLite are synchronous to the DB but the
    // OPFS spool lives in a separate tree — drop it explicitly so the
    // next ingest writes byte 0..N afresh instead of growing on top of
    // the old payload.
    try {
      await removeSpool(newSource.id);
    } catch (err) {
      console.warn('[coordinator] reIngestSource: removeSpool failed', err);
    }
    try {
      await deps.getIndexer().proxy.upsertSource(newSource);
    } catch (err) {
      console.warn('[coordinator] reIngestSource: upsertSource failed', err);
      return;
    }
    startIngest(newSource);
    emitChange();
  };

  /**
   * Build a copy of `source` with `parserId` overridden. Only the kinds
   * that participate in parser-pool dispatch carry the field — stub
   * kinds are returned unchanged.
   */
  const withParserId = (source: LogSource, parserId: string | undefined): LogSource => {
    switch (source.kind) {
      case 'file':
      case 'directory':
      case 'text':
      case 'url':
      case 'stream':
        return { ...source, parserId };
      default:
        return source;
    }
  };

  /**
   * Walk every live source and re-ingest those whose `parserId` matches
   * `affectedParserId`. Used after `upsertCustomParser` /
   * `removeCustomParser` so existing entries reflect the new (or absent)
   * parser. `nextParserId` is what to set on the source itself:
   *   - same id (after upsert) → unchanged, but registry now has the new compile
   *   - `undefined` (after remove) → fall back to auto-detect
   */
  const reIngestSourcesWithParser = async (
    affectedParserId: string,
    nextParserId: string | undefined,
  ): Promise<void> => {
    const affected: LogSource[] = [];
    for (const entry of sources.values()) {
      const sourceParser = 'parserId' in entry.source ? entry.source.parserId : undefined;
      if (sourceParser === affectedParserId) {
        affected.push(withParserId(entry.source, nextParserId));
      }
    }
    // Sequential to bound peak parser-pool / SQLite pressure when several
    // sources rely on the same parser; switching all of them in parallel
    // would queue N full file-scans concurrently.
    for (const src of affected) {
      await reIngestSource(src);
    }
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
    invalidateFreeTextCache();
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
      if (!deps.adapterFactories[input.kind]) {
        throw new Error(
          `addSource: no adapter for source kind '${input.kind}' (probably not implemented yet)`,
        );
      }
      const id = newSourceId();
      const source = buildLogSource(input, id);

      // Surface the source in the sidebar *before* the synchronous
      // pipeline (indexer.opening / upsertSource / handleStore.put) so
      // the user gets immediate feedback. The status flips to
      // loading/indexing/streaming as soon as the adapter starts; if the
      // pipeline rejects, we replace it with an error status below.
      sources.set(id, { source, status: { kind: 'queued' }, aborter: null });
      emitStatus();

      try {
        await deps.getIndexer().opening;
        await deps.getIndexer().proxy.upsertSource(source);

        // Persist handle for sources that can be revived after reload.
        // Errors here are non-fatal — persistence is just a "resume after
        // reload" affordance; if it fails (e.g. structured-clone of a
        // native FileSystemDirectoryHandle hits a browser quirk), we still
        // want the source to show up in the sidebar and start ingesting in
        // this session.
        if (source.kind === 'directory') {
          try {
            const handleStore = await deps.handleStoreOpening;
            await handleStore.put({
              sourceId: id,
              kind: 'directory',
              name: source.name,
              handle: source.handle,
              createdAt: Date.now(),
            });
          } catch (err) {
            console.warn(
              `[coordinator] handleStore.put failed for source ${id} (will not survive reload):`,
              err instanceof Error ? err.message : err,
            );
          }
        }
      } catch (err) {
        // Indexer setup or upsertSource failed — keep the source visible
        // but mark it as errored so the user can retry/remove.
        sources.set(id, {
          source,
          status: {
            kind: 'error',
            error: {
              name: err instanceof Error ? err.name : 'Error',
              message: err instanceof Error ? err.message : String(err),
            },
          },
          aborter: null,
        });
        emitStatus();
        throw err;
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
      // Free-text matches are filter-keyed; drop the cached array so the
      // next `getRange`/`getCount` rescans against the new filter.
      invalidateFreeTextCache();
    },
    getFilter: async () => activeFilter,

    getRange: async (from, to) => {
      await deps.getIndexer().opening;
      const compiled = compileFreeTextQuery(activeFilter);
      if (compiled !== null) {
        const matches = await ensureFreeTextMatches(activeFilter, compiled);
        return matches.slice(from, to);
      }
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

    getEntriesScoped: async (filter, from, to) => {
      await deps.getIndexer().opening;
      const pointers = await deps.getIndexer().proxy.search(filter, from, to);
      return resolvePointersToEntries(
        pointers,
        (id) => sources.get(id)?.source ?? null,
        deps.parserPool,
      );
    },

    getCount: async () => {
      await deps.getIndexer().opening;
      const compiled = compileFreeTextQuery(activeFilter);
      if (compiled !== null) {
        const [total, matches] = await Promise.all([
          deps.getIndexer().proxy.count(EMPTY_FILTER),
          ensureFreeTextMatches(activeFilter, compiled),
        ]);
        return { total, filtered: matches.length };
      }
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

    getFieldSchema: async (filter) => {
      await deps.getIndexer().opening;
      // `filter.sources === null` → caller wants every known source.
      const sourceIds = filter.sources && filter.sources.length > 0
        ? filter.sources
        : [...sources.keys()];
      const dynamic = await deps.getIndexer().proxy.fieldMeta(sourceIds);
      // Built-ins are appended last — UI can re-sort by occurrences,
      // presenceRate, label, etc. without losing the @-set.
      return [...dynamic, ...BUILT_IN_FIELD_DESCRIPTORS];
    },

    listParsers: async () => {
      const metas = await deps.parserPool.withWorker((p) => p.listParsers());
      return metas.map((m) => ({
        id: m.id,
        defaultColumns: m.defaultColumns,
      }));
    },

    listCustomParsers: async () => {
      const store = await deps.customParserStoreOpening;
      return store.list();
    },

    upsertCustomParser: async (def: CustomParserDef) => {
      const store = await deps.customParserStoreOpening;
      await store.put(def);
      const all = await store.list();
      // Push the updated list to every pool worker (and remember it
      // for late-spawned ones).
      await deps.parserPool.loadCustomParsers(all);
      // Re-ingest sources pinned to this parser id so their entries
      // reflect the new compiled regex; the parserId on the source
      // itself stays the same.
      await reIngestSourcesWithParser(def.id, def.id);
    },

    removeCustomParser: async (id: string) => {
      const store = await deps.customParserStoreOpening;
      await store.delete(id);
      const all = await store.list();
      await deps.parserPool.loadCustomParsers(all);
      // Sources that depended on the now-deleted parser fall back to
      // auto-detect — strip their parserId and re-ingest.
      await reIngestSourcesWithParser(id, undefined);
    },

    setSourceParser: async (id, parserId) => {
      const entry = sources.get(id);
      if (!entry) return;
      const next = withParserId(entry.source, parserId ?? undefined);
      await reIngestSource(next);
    },

    listSources: async () => {
      await hydratePersisted();
      return snapshotSources();
    },

    subscribeStatus: async (cb) => {
      statusListeners.add(cb);
      // Send the current snapshot immediately so the sidebar gets
      // its first render even if hydration is still running (or has
      // failed). Hydration kicks off `emitStatus()` once it lands, so
      // persisted directory chips appear automatically without
      // blocking this initial paint.
      void cb(snapshotSources());
      void hydratePersisted();
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
