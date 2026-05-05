import * as Comlink from 'comlink';
import type { IndexerApi, OpenReport } from '../../core/rpc/indexer.contract.ts';
import { defaultAdapterFactories } from '../../core/sources/index.ts';
import { createCoordinatorApi } from './coordinator.ts';
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
    new Worker(new URL('../parser/index.ts', import.meta.url), { type: 'module' }),
});

// Lazy indexer: the worker + SQLite/OPFS pool are not started until a
// coordinator method actually needs them. Memoize after the first access so
// every later call shares one worker (the OPFS SAH-pool VFS would otherwise
// fight with itself).
let indexerWorker: Worker | null = null;
let indexerProxy: Comlink.Remote<IndexerApi> | null = null;
let indexerOpeningPromise: Promise<OpenReport> | null = null;
const getIndexer = (): {
  proxy: Comlink.Remote<IndexerApi>;
  opening: Promise<OpenReport>;
} => {
  if (indexerProxy === null) {
    indexerWorker = new Worker(
      new URL('../indexer/index.ts', import.meta.url),
      { type: 'module' },
    );
    indexerProxy = Comlink.wrap<IndexerApi>(indexerWorker);
    indexerOpeningPromise = indexerProxy.open();
  }
  return { proxy: indexerProxy, opening: indexerOpeningPromise! };
};

// Handle store opens its own IndexedDB lazily; coordinator awaits the promise
// inside any method that touches handles. This keeps Comlink.expose synchronous
// so main-thread RPC calls don't race the IDB open.
const handleStoreOpening = HandleStore.open();

const coordinatorApi = createCoordinatorApi({
  parserPool,
  getIndexer,
  adapterFactories: defaultAdapterFactories,
  handleStoreOpening,
});

Comlink.expose(coordinatorApi);
