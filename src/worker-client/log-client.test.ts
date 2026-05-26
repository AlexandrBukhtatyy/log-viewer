import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * log-client owns the bfcache lifecycle: shutdownViewStore tears the
 * worker pipeline down, subscribeStoreReset lets React swap out the
 * dead store, and module-level pagehide/pageshow listeners wire those
 * together. None of that requires a real Worker — we mock Comlink and
 * the Worker constructor, then drive the listeners by hand.
 */

interface CapturedHandlers {
  pagehide: ((event: { persisted: boolean }) => void) | null;
  pageshow: ((event: { persisted: boolean }) => void) | null;
}

interface Mocks {
  workerTerminate: ReturnType<typeof vi.fn>;
  workerCreated: ReturnType<typeof vi.fn>;
  shutdownIndexer: ReturnType<typeof vi.fn>;
  subscribeStatus: ReturnType<typeof vi.fn>;
  subscribeChanges: ReturnType<typeof vi.fn>;
  resumePersisted: ReturnType<typeof vi.fn>;
  setFilter: ReturnType<typeof vi.fn>;
  getCount: ReturnType<typeof vi.fn>;
  getRange: ReturnType<typeof vi.fn>;
  handlers: CapturedHandlers;
}

type LogClientModule = typeof import('./log-client.ts');

const setupMocks = (): Mocks => {
  const handlers: CapturedHandlers = { pagehide: null, pageshow: null };

  const workerTerminate = vi.fn();
  const workerCreated = vi.fn();

  class MockWorker {
    terminate = workerTerminate;
    postMessage = vi.fn();
    addEventListener = vi.fn();
    removeEventListener = vi.fn();
    onmessage: unknown = null;
    onerror: unknown = null;
    constructor() {
      workerCreated();
    }
  }
  vi.stubGlobal('Worker', MockWorker as unknown as typeof Worker);

  vi.stubGlobal('window', {
    addEventListener: (event: string, cb: unknown) => {
      if (event === 'pagehide') {
        handlers.pagehide = cb as CapturedHandlers['pagehide'];
      } else if (event === 'pageshow') {
        handlers.pageshow = cb as CapturedHandlers['pageshow'];
      }
    },
    removeEventListener: vi.fn(),
  });

  const shutdownIndexer = vi.fn().mockResolvedValue(undefined);
  const subscribeStatus = vi.fn().mockResolvedValue(() => {});
  const subscribeChanges = vi.fn().mockResolvedValue(() => {});
  const resumePersisted = vi.fn().mockResolvedValue({});
  const setFilter = vi.fn().mockResolvedValue(undefined);
  const getCount = vi.fn().mockResolvedValue({ total: 0, filtered: 0 });
  const getRange = vi.fn().mockResolvedValue([]);

  vi.doMock('comlink', () => ({
    wrap: () => ({
      shutdownIndexer,
      subscribeStatus,
      subscribeChanges,
      resumePersistedSources: resumePersisted,
      setFilter,
      getCount,
      getRange,
    }),
    proxy: <T,>(fn: T) => fn,
  }));

  return {
    workerTerminate,
    workerCreated,
    shutdownIndexer,
    subscribeStatus,
    subscribeChanges,
    resumePersisted,
    setFilter,
    getCount,
    getRange,
    handlers,
  };
};

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('log-client — bfcache lifecycle', () => {
  let mocks: Mocks;
  let mod: LogClientModule;

  beforeEach(async () => {
    vi.resetModules();
    vi.unstubAllGlobals();
    mocks = setupMocks();
    mod = await import('./log-client.ts');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock('comlink');
  });

  it('getOrCreateViewStore returns the same singleton on repeated calls', () => {
    const a = mod.getOrCreateViewStore();
    const b = mod.getOrCreateViewStore();
    expect(a).toBe(b);
  });

  it('shutdownViewStore tears down the pipeline and clears the singleton', async () => {
    const store = mod.getOrCreateViewStore();
    // Force the lazy api() path: refresh() touches setFilter/getCount, which
    // spawns the coordinator worker and arms subscriptions.
    await store.getState().refresh();

    expect(mocks.workerCreated).toHaveBeenCalledTimes(1);
    expect(mocks.subscribeStatus).toHaveBeenCalledTimes(1);

    await mod.shutdownViewStore();

    expect(mocks.shutdownIndexer).toHaveBeenCalledTimes(1);
    expect(mocks.workerTerminate).toHaveBeenCalledTimes(1);

    // After reset a new singleton is created — proving the module-level
    // ref was nulled.
    const fresh = mod.getOrCreateViewStore();
    expect(fresh).not.toBe(store);
  });

  it('shutdownViewStore is a no-op when the store was never created', async () => {
    await expect(mod.shutdownViewStore()).resolves.toBeUndefined();
    expect(mocks.workerCreated).not.toHaveBeenCalled();
    expect(mocks.shutdownIndexer).not.toHaveBeenCalled();
  });

  it('subscribeStoreReset invokes the callback after pageshow reset; unsubscribe stops it', async () => {
    const cb = vi.fn();
    const unsubscribe = mod.subscribeStoreReset(cb);

    expect(mocks.handlers.pageshow).not.toBeNull();
    mocks.handlers.pageshow!({ persisted: true });
    await flush();

    expect(cb).toHaveBeenCalledTimes(1);

    unsubscribe();
    mocks.handlers.pageshow!({ persisted: true });
    await flush();

    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('pagehide(persisted=true) tears down the pipeline; persisted=false is a no-op', async () => {
    const store = mod.getOrCreateViewStore();
    await store.getState().refresh();

    expect(mocks.handlers.pagehide).not.toBeNull();

    mocks.handlers.pagehide!({ persisted: false });
    await flush();
    expect(mocks.shutdownIndexer).not.toHaveBeenCalled();
    expect(mocks.workerTerminate).not.toHaveBeenCalled();

    mocks.handlers.pagehide!({ persisted: true });
    await flush();
    expect(mocks.shutdownIndexer).toHaveBeenCalledTimes(1);
    expect(mocks.workerTerminate).toHaveBeenCalledTimes(1);
  });

  it('pageshow(persisted=true) recreates the singleton and notifies subscribers', async () => {
    const cb = vi.fn();
    mod.subscribeStoreReset(cb);

    const oldStore = mod.getOrCreateViewStore();
    await oldStore.getState().refresh();

    mocks.handlers.pageshow!({ persisted: true });
    await flush();

    expect(cb).toHaveBeenCalledTimes(1);
    const newStore = mod.getOrCreateViewStore();
    expect(newStore).not.toBe(oldStore);
  });

  it('pageshow(persisted=false) is a no-op', async () => {
    const cb = vi.fn();
    mod.subscribeStoreReset(cb);
    const store = mod.getOrCreateViewStore();

    mocks.handlers.pageshow!({ persisted: false });
    await flush();

    expect(cb).not.toHaveBeenCalled();
    expect(mod.getOrCreateViewStore()).toBe(store);
  });
});
