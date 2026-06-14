import * as Comlink from 'comlink';
import type {
  IndexerApi,
  OpenReport,
} from '../../core/rpc/indexer.contract.ts';
import { defaultAdapterFactories } from '../../core/sources/index.ts';
import { createCoordinatorApi } from './coordinator.ts';
import { CustomParserStore } from './custom-parsers/store.ts';
import { HandleStore } from './handles/handle-store.ts';
import {
  DEFAULT_POOL_IDLE_TTL_MS,
  ParserPool,
  recommendedPoolSize,
} from './pool/parser-pool.ts';

// Parser pool: workers are spawned only when ingest actually runs, and
// terminated again after `DEFAULT_POOL_IDLE_TTL_MS` of no traffic.
const parserPool = new ParserPool({
  maxSize: recommendedPoolSize(),
  idleTtlMs: DEFAULT_POOL_IDLE_TTL_MS,
  createWorker: () =>
    new Worker(new URL('../parser/index.ts', import.meta.url), {
      type: 'module',
    }),
});

// Lazy indexer: the worker + SQLite/OPFS pool are not started until a
// coordinator method actually needs them. Memoize after the first access so
// every later call shares one worker (the OPFS SAH-pool VFS would otherwise
// fight with itself).
//
// On open() rejection (typically: SAH-pool lock conflict during the page-load
// race with a soon-to-be-GC'd previous worker) the cached state is reset so
// the next coordinator call can spawn a fresh worker and retry. Without this
// one transient failure wedges the indexer for the rest of the session.
let indexerWorker: Worker | null = null;
let indexerProxy: Comlink.Remote<IndexerApi> | null = null;
let indexerOpeningPromise: Promise<OpenReport> | null = null;
const getIndexer = (): {
  proxy: Comlink.Remote<IndexerApi>;
  opening: Promise<OpenReport>;
} => {
  if (indexerProxy === null) {
    const worker = new Worker(new URL('../indexer/index.ts', import.meta.url), {
      type: 'module',
    });
    const proxy = Comlink.wrap<IndexerApi>(worker);
    const opening = proxy.open();
    opening.catch(() => {
      // Only clear if we're still pointing at this same proxy — guard against
      // a later getIndexer() having already swapped state out from under us.
      if (indexerProxy === proxy) {
        worker.terminate();
        indexerWorker = null;
        indexerProxy = null;
        indexerOpeningPromise = null;
      }
    });
    indexerWorker = worker;
    indexerProxy = proxy;
    indexerOpeningPromise = opening;
  }
  return { proxy: indexerProxy, opening: indexerOpeningPromise! };
};

/**
 * Terminate the indexer worker and release the OPFS SAH-pool lock it
 * holds. Used by the main-thread HMR/destroy path so HMR module
 * replacement doesn't orphan a child worker that keeps the SAH-pool
 * locked for the next reload's tens of seconds.
 */
const shutdownIndexer = async (): Promise<void> => {
  if (indexerProxy !== null) {
    try {
      await indexerProxy.close();
    } catch {
      /* worker already dying — ignore */
    }
  }
  if (indexerWorker !== null) {
    indexerWorker.terminate();
  }
  indexerWorker = null;
  indexerProxy = null;
  indexerOpeningPromise = null;
};

// Handle store opens its own IndexedDB lazily; coordinator awaits the promise
// inside any method that touches handles. This keeps Comlink.expose synchronous
// so main-thread RPC calls don't race the IDB open.
const handleStoreOpening = HandleStore.open();

// Custom-parser store (Phase 2.C). Separate IDB from handles so wiping
// OPFS or persisted source handles doesn't drop user-crafted parser
// definitions.
const customParserStoreOpening = CustomParserStore.open();

const coordinatorApi = createCoordinatorApi({
  parserPool,
  getIndexer,
  shutdownIndexer,
  adapterFactories: defaultAdapterFactories,
  handleStoreOpening,
  customParserStoreOpening,
});

Comlink.expose(coordinatorApi);
