import * as Comlink from 'comlink';
import type { IndexerApi } from '../../core/rpc/indexer.contract.ts';
import { defaultAdapterFactories } from '../../core/sources/index.ts';
import { createCoordinatorApi } from './coordinator.ts';
import { HandleStore } from './handles/handle-store.ts';
import { ParserPool, recommendedPoolSize } from './pool/parser-pool.ts';

const parserPool = new ParserPool({
  size: recommendedPoolSize(),
  createWorker: () =>
    new Worker(new URL('../parser/index.ts', import.meta.url), { type: 'module' }),
});

const indexerWorker = new Worker(
  new URL('../indexer/index.ts', import.meta.url),
  { type: 'module' },
);
const indexerProxy = Comlink.wrap<IndexerApi>(indexerWorker);

const indexerOpening = indexerProxy.open();

// Handle store opens its own IndexedDB lazily; coordinator awaits the promise
// inside any method that touches handles. This keeps Comlink.expose synchronous
// so main-thread RPC calls don't race the IDB open.
const handleStoreOpening = HandleStore.open();

const coordinatorApi = createCoordinatorApi({
  parserPool,
  indexer: indexerProxy,
  indexerOpening,
  adapterFactories: defaultAdapterFactories,
  handleStoreOpening,
});

Comlink.expose(coordinatorApi);
