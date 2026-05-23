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
import { removeAllSpool, removeSpool } from '../../core/storage/opfs-spool.ts';
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
  /**
   * Resolves when the background `ingestSource(...)` task fully exits
   * (either reaches EOF or honours an abort). `removeSource` awaits this
   * before deleting the indexer rows so an in-flight `insertBatch` cannot
   * race past the delete and leave orphaned rows in `entry`.
   */
  ingest?: Promise<void>;
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
  /**
   * Terminate the indexer worker and release its OPFS SAH-pool lock.
   * Called from `shutdownIndexer` (HMR/destroy path). After this resolves,
   * the next `getIndexer()` call respawns from scratch.
   */
  readonly shutdownIndexer: () => Promise<void>;
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
        // Directory rows in SQLite without a matching IDB handle are
        // unrecoverable — the FS handle is gone, so the source can never be
        // re-ingested. Auto-purge them instead of surfacing 11 ghost chips
        // in the sidebar. Typical trigger: `clearAll` wiped IDB but
        // `proxy.clearAll()` couldn't run because the indexer hadn't opened
        // (OPFS SAH lock from a sibling tab). After auto-cleanup, the user
        // sees a clean sidebar and just re-adds the folder.
        const orphanIds: SourceId[] = [];
        for (const rec of indexed) {
          if (sources.has(rec.id)) continue; // already live
          let logSource: LogSource | null = null;
          if (rec.kind === 'directory') {
            const persisted = handleByIdx.get(rec.id);
            const meta = rec.metaJson
              ? (JSON.parse(rec.metaJson) as {
                  glob?: string;
                  watch?: boolean;
                  parserId?: string;
                })
              : {};
            if (persisted && persisted.kind === 'directory') {
              logSource = {
                kind: 'directory',
                id: rec.id,
                name: rec.name,
                handle: persisted.handle as FileSystemDirectoryHandle,
                glob: meta.glob,
                watch: meta.watch,
                parserId: meta.parserId,
              };
            } else {
              orphanIds.push(rec.id);
              continue;
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
        if (orphanIds.length > 0) {
          console.warn(
            `[coordinator] hydratePersisted: auto-purging ${orphanIds.length} orphan directory source(s) (SQLite row without IDB handle)`,
            orphanIds,
          );
          // Best-effort cleanup; failures here just leave the row in
          // SQLite for the next hydration to clean up. We don't surface
          // them as live sources either — they're unrecoverable anyway.
          await Promise.allSettled(
            orphanIds.map(async (id) => {
              try {
                await deps.getIndexer().proxy.removeSource(id);
              } catch (err) {
                console.warn(
                  `[coordinator] hydratePersisted: removeSource(${id}) failed`,
                  err,
                );
                throw err;
              }
              try {
                await removeSpool(id);
              } catch (err) {
                console.warn(
                  `[coordinator] hydratePersisted: removeSpool(${id}) failed`,
                  err,
                );
              }
            }),
          );
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

  // Ingest fires `onChange` once per inserted batch (see
  // ingest-orchestrator). A large file produces dozens of batches per
  // second, and each propagation through the change pipeline (count RPC →
  // subscriber callback → main-thread refresh) blocks the user-perceived
  // path for ~10–20 ms. Throttling here coalesces a burst of inserts into
  // one user-visible update: the **first** event of a burst fires
  // immediately (start of ingest is responsive), subsequent events inside
  // the window get collapsed and re-fired once when the window closes.
  const CHANGE_THROTTLE_MS = 200;
  let lastChangeEmittedAt = 0;
  let throttledChangeTimer: ReturnType<typeof setTimeout> | null = null;

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
   * Surface an already-indexed source as live without re-ingesting. Used by
   * resume / grantPermission / addSource-promote paths when SQLite already
   * holds entry rows for this source from a previous session. Skipping
   * ingest here is critical: otherwise every page reload would append
   * another full copy of the directory's contents (each ingest adds new
   * entry UUIDs over the existing rows, multiplying the entry count by
   * roughly the number of reloads). If users want fresh data they can
   * Remove and Add the source again, which assigns a new source id.
   *
   * Returns true if the source was surfaced as `{ kind: 'done' }`; false if
   * the caller should fall through to a fresh `startIngest`.
   */
  const tryResumeAsDone = (
    source: LogSource,
    rec: SourceRecord | undefined,
  ): boolean => {
    const entryCount =
      rec?.status.kind === 'done' ? rec.status.entryCount : 0;
    if (entryCount <= 0) return false;
    sources.set(source.id, {
      source,
      status: { kind: 'done', entryCount },
      aborter: null,
      parserId: rec?.parserId,
      parserDefaultColumns: rec?.parserDefaultColumns,
    });
    persistedRecords.delete(source.id);
    emitStatus();
    return true;
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
    const ingestPromise = ingestSource({
      source,
      adapter,
      parserPool: deps.parserPool,
      indexer: deps.getIndexer().proxy,
      signal: aborter.signal,
      onStatus: (status) => {
        const entry = sources.get(source.id);
        if (!entry) return; // source already removed — drop stale status
        entry.status = status;
        emitStatus();
      },
      onChange: () => {
        // Drop stale change notices for a source that was removed mid-batch
        // (sources.delete in removeSource happens before we await the ingest
        // task). Without this guard a final `insertBatch` would trigger an
        // emitChange against an indexer row set that's about to be deleted.
        if (!sources.has(source.id)) return;
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
    }).catch((err: unknown) => {
      // Aborts surface as AbortError-shaped throws; everything else is a
      // real ingest failure. Swallow here so `removeSource`'s await
      // never re-throws; ingestSource itself surfaces errors via
      // onStatus({ kind: 'error', ... }) for the UI.
      const name = err instanceof Error ? err.name : '';
      if (name !== 'AbortError') {
        console.warn(`[coordinator] ingest task for ${source.id} crashed`, err);
      }
    });
    const entry = sources.get(source.id);
    if (entry) entry.ingest = ingestPromise;
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

  const dispatchChangeNotice = (): void => {
    lastChangeEmittedAt = Date.now();
    if (pendingFilteredCount !== null) return; // already in-flight; will reflect latest version
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

  const emitChange = (): void => {
    version++;
    invalidateFreeTextCache();
    const now = Date.now();
    const elapsed = now - lastChangeEmittedAt;
    if (elapsed >= CHANGE_THROTTLE_MS && throttledChangeTimer === null) {
      // Leading edge of a quiet period — fire immediately so the user
      // sees the first ingest delta with no delay.
      dispatchChangeNotice();
      return;
    }
    // Inside the window — coalesce. The trailing dispatch picks up the
    // latest `version` because `version` is module-scoped, not captured.
    if (throttledChangeTimer !== null) return;
    const wait = Math.max(0, CHANGE_THROTTLE_MS - elapsed);
    throttledChangeTimer = setTimeout(() => {
      throttledChangeTimer = null;
      dispatchChangeNotice();
    }, wait);
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

      // Optimistic insert: surface the source in the sidebar BEFORE the
      // hydrate-await, the dedup loops, and the indexer/handle-store IO.
      // The user sees the spinner the moment they hit "Add" and the rest
      // of the addSource flow continues asynchronously. If the directory
      // dedup decides this is a duplicate, the optimistic row is removed
      // below before the existing id is returned (or the persisted record
      // is promoted).
      sources.set(id, { source, status: { kind: 'queued' }, aborter: null });
      emitStatus();

      // Wait for the initial hydrate so `persistedRecords` is fully
      // populated before the directory dedup loop runs. Without this an
      // `addSource` call that races the page-load hydrate (user clicks
      // "+ Add source" within the first ~50 ms after reload) sees an
      // empty `persistedRecords`, misses the existing handle, and
      // creates a parallel duplicate. `hydratePersisted` is memoised so
      // this is a no-op once the eager kick-off has resolved.
      await hydratePersisted();

      // Directory dedupe: a fresh picker selection may point at a folder
      // we already track (live or persisted). FileSystemDirectoryHandle
      // is not reference-equal across picker invocations, so we ask the
      // platform via `isSameEntry`. On match we either surface the
      // existing id outright (live case) or promote a persisted-only
      // record back to live, reusing the same indexer rows.
      if (source.kind === 'directory') {
        for (const [existingId, entry] of sources) {
          if (existingId === id) continue; // skip our own optimistic row
          if (entry.source.kind !== 'directory') continue;
          try {
            if (await source.handle.isSameEntry(entry.source.handle)) {
              sources.delete(id);
              emitStatus();
              return existingId;
            }
          } catch {
            /* incompatible handles — fall through */
          }
        }
        for (const [existingId, rec] of persistedRecords) {
          if (rec.source.kind !== 'directory') continue;
          try {
            if (await source.handle.isSameEntry(rec.source.handle)) {
              // Promote persisted → live with the freshly-granted handle.
              // Reuse the existing id so indexer rows stay attached. Drop
              // the optimistic row before promoting so the sidebar
              // doesn't briefly show two rows.
              sources.delete(id);
              const promoted: LogSource = {
                ...rec.source,
                handle: source.handle,
                glob: source.glob ?? rec.source.glob,
                watch: source.watch ?? rec.source.watch,
                parserId: source.parserId ?? rec.source.parserId,
              };
              try {
                const handleStore = await deps.handleStoreOpening;
                await handleStore.put({
                  sourceId: existingId,
                  kind: 'directory',
                  name: promoted.name,
                  handle: source.handle,
                  createdAt: Date.now(),
                });
              } catch (err) {
                console.warn(
                  `[coordinator] addSource: handleStore.put failed during promote of ${existingId}:`,
                  err instanceof Error ? err.message : err,
                );
              }
              // If the persisted record already has entries from a prior
              // session, surface it as live without re-ingesting; otherwise
              // a user who re-picks the same folder via Add source would
              // double up its entries in SQLite. Fresh data path: Remove +
              // Add (new source id, no merge).
              if (!tryResumeAsDone(promoted, rec)) {
                // startIngest emits status with the promoted row; no manual
                // emit needed for the optimistic delete above.
                startIngest(promoted);
              }
              return existingId;
            }
          } catch {
            /* incompatible handles — fall through */
          }
        }
      }

      try {
        await deps.getIndexer().opening;
        await deps.getIndexer().proxy.upsertSource(source);

        // Persist handle for sources that can be revived after reload.
        //
        // Directory rows in SQLite without a matching IDB handle become
        // permanent orphans on the next page load (hydratePersisted surfaces
        // them with "Folder handle is missing from local storage"). If IDB
        // write fails, roll back the SQLite row so the two stores stay
        // consistent and the user can simply try again.
        //
        // Non-directory kinds don't persist handles, so this branch is a
        // no-op for them.
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
              `[coordinator] handleStore.put failed for source ${id}; rolling back SQLite row to avoid orphan:`,
              err instanceof Error ? err.message : err,
            );
            try {
              await deps.getIndexer().proxy.removeSource(id);
            } catch (rollbackErr) {
              console.warn(
                `[coordinator] addSource: rollback removeSource(${id}) failed; SQLite row will appear as an orphan after reload:`,
                rollbackErr instanceof Error ? rollbackErr.message : rollbackErr,
              );
            }
            throw err instanceof Error
              ? err
              : new Error(String(err));
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
      // Order matters: abort the ingest signal, drop the entry from the
      // live map (so any stale onStatus/onChange callbacks early-return),
      // THEN await the ingest task to fully exit. Only after it's gone
      // can we safely delete indexer rows without an in-flight
      // insertBatch landing on top of the delete and leaving orphans.
      const ingestPromise = entry?.ingest;
      if (entry) {
        entry.aborter?.abort();
        sources.delete(id);
      }
      persistedRecords.delete(id);
      if (ingestPromise) {
        try {
          await ingestPromise;
        } catch {
          // ingestPromise is `.catch`-wrapped in startIngest so it never
          // rejects; this is just a belt-and-braces safety net.
        }
      }
      const handleStore = await deps.handleStoreOpening;
      await Promise.all([
        deps.getIndexer().proxy.removeSource(id),
        handleStore.delete(id),
        // OPFS-spool cleanup — text/url/snapshot/stream sources write
        // their body bytes to `lv-spool/<id>/`. Directory/file sources
        // read from the user-supplied FS handle, so they have no spool
        // and `removeSpool` is a no-op for them (it tolerates absent
        // directories).
        removeSpool(id).catch((err: unknown) => {
          console.warn(
            `[coordinator] removeSpool failed for ${id}:`,
            err instanceof Error ? err.message : err,
          );
        }),
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
      // Send whatever snapshot we have right now (possibly empty if
      // the eager hydration hasn't landed yet). This unsticks the
      // sidebar skeleton even when the indexer worker stalls.
      void cb(snapshotSources());
      // Then re-send to *this specific cb* after hydration completes —
      // covers the race where eager hydration finished before this
      // subscriber existed, so the in-IIFE `emitStatus` had no
      // listeners. Without this, persistedRecords would be populated
      // but the sidebar would never learn about it until the next
      // unrelated `emitStatus` (e.g. user adds a source).
      void hydratePersisted().then(() => {
        if (!statusListeners.has(cb)) return; // unsubscribed in the meantime
        void cb(snapshotSources());
      });
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
          const sourceFull: LogSource = { ...rec.source, handle };
          if (!tryResumeAsDone(sourceFull, rec)) {
            startIngest(sourceFull);
          }
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
      if (!tryResumeAsDone(source, rec)) {
        startIngest(source);
      }
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
      // Same order as removeSource (ADR-0022): abort + drop from `sources`
      // first so stale onStatus/onChange callbacks early-return, then await
      // every ingest task before deleting indexer rows.
      const ingestPromises: Promise<void>[] = [];
      for (const entry of sources.values()) {
        entry.aborter?.abort();
        if (entry.ingest) ingestPromises.push(entry.ingest);
      }
      sources.clear();
      persistedRecords.clear();
      // Emit the empty snapshot immediately so the sidebar visually
      // clears within milliseconds. The heavy cleanup (ingest drain,
      // SQLite DELETE, OPFS recursive remove) keeps running below but
      // the user already sees the result.
      emitStatus();
      emitChange();
      if (ingestPromises.length > 0) {
        try {
          await Promise.all(ingestPromises);
        } catch {
          /* ingestPromises are .catch-wrapped in startIngest */
        }
      }

      // SQLite wipe needs the indexer to be open. If it's stuck (OPFS SAH
      // lock from a sibling tab), we used to throw and skip the IDB / OPFS
      // wipe too — leaving the user with a stale SQLite full of soon-to-be
      // orphans on next load. Now: try to open with a budget, and if it
      // doesn't open in time, skip the SQLite call but STILL wipe IDB and
      // OPFS-spool. `hydratePersisted`'s auto-purge will collect the
      // surviving SQLite rows on the next page load.
      const OPENING_BUDGET_MS = 5000;
      let canWipeIndexer = false;
      try {
        await Promise.race([
          deps.getIndexer().opening,
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error('indexer-opening-timeout')),
              OPENING_BUDGET_MS,
            ),
          ),
        ]);
        canWipeIndexer = true;
      } catch (err) {
        console.warn(
          '[coordinator] clearAll: indexer not open within budget; skipping SQLite wipe (will be cleaned on next load)',
          err instanceof Error ? err.message : err,
        );
      }

      const handleStore = await deps.handleStoreOpening;
      const customParserStore = await deps.customParserStoreOpening;
      // `allSettled` rather than `all`: if one backend goes south
      // (e.g. the indexer worker dies mid-DELETE), the others must
      // still finish — otherwise we leave SQLite and IDB in
      // inconsistent states and the next page-load surfaces every
      // un-wiped row as an orphan. The caller gets a single aggregated
      // error describing which backends actually failed.
      const settled = await Promise.allSettled([
        canWipeIndexer
          ? deps.getIndexer().proxy.clearAll()
          : Promise.reject(new Error('indexer not open')),
        handleStore.clearAll(),
        // Custom parser definitions live in their own IDB (separate from
        // handles, see ADR-0018). User explicitly asked for "clear all",
        // so wipe these too.
        customParserStore.clearAll(),
        // OPFS bodies for text/url/snapshot/stream sources — same gap
        // that ADR-0022 fixed for `removeSource`, now extended to the
        // bulk path.
        removeAllSpool(),
      ]);
      const backends = ['indexer', 'handleStore', 'customParserStore', 'opfs-spool'] as const;
      const failures: string[] = [];
      settled.forEach((result, i) => {
        if (result.status === 'rejected') {
          const reason = result.reason;
          const message = reason instanceof Error ? reason.message : String(reason);
          console.warn(`[coordinator] clearAll: ${backends[i]} failed:`, reason);
          failures.push(`${backends[i]}: ${message}`);
        }
      });
      if (failures.length > 0) {
        throw new Error(
          `clearAll: partial wipe — ${failures.length} backend(s) failed: ${failures.join('; ')}`,
        );
      }
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

    shutdownIndexer: async () => {
      // Abort any in-flight ingests first so they don't try to write to a
      // worker we're about to terminate (would hang on Comlink RPC).
      for (const entry of sources.values()) {
        entry.aborter?.abort();
      }
      await deps.shutdownIndexer();
    },
  };
};
