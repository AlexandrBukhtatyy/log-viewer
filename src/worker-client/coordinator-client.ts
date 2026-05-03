import * as Comlink from 'comlink';
import type { CoordinatorApi } from '../core/rpc/coordinator.contract.ts';

export interface CoordinatorClient {
  readonly api: Comlink.Remote<CoordinatorApi>;
  destroy: () => void;
}

export const createCoordinatorClient = (): CoordinatorClient => {
  const worker = new Worker(
    new URL('../workers/coordinator/index.ts', import.meta.url),
    { type: 'module' },
  );
  const api = Comlink.wrap<CoordinatorApi>(worker);
  return {
    api,
    destroy: () => worker.terminate(),
  };
};
