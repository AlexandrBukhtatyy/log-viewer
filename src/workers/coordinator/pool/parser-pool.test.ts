import { describe, expect, it, vi } from 'vitest';
import { ParserPool } from './parser-pool.ts';

/**
 * Comlink.wrap is mocked away — we don't really need a Worker to test the
 * pool's lifecycle invariants (spawn cap, idle reap, queueing). Each "worker"
 * is just a tagged stub with a `terminate` spy.
 */
vi.mock('comlink', () => ({
  wrap: <T>(w: { __id: number }) =>
    ({ __id: w.__id, ping: () => `worker-${w.__id}` }) as unknown as T,
}));

let nextId = 0;
const makeWorker = () => {
  const w = {
    __id: ++nextId,
    terminate: vi.fn(),
  };
  return w as unknown as Worker;
};

const flushMicrotasks = () => new Promise<void>((r) => setTimeout(r, 0));

describe('ParserPool — dynamic lifecycle', () => {
  it('starts empty (no workers spawned on construction)', () => {
    const pool = new ParserPool({
      maxSize: 4,
      idleTtlMs: 1000,
      createWorker: makeWorker,
    });
    expect(pool.size).toBe(0);
    expect(pool.busyCount).toBe(0);
  });

  it('spawns a worker on first acquire and reuses it on second', async () => {
    const create = vi.fn(makeWorker);
    const pool = new ParserPool({
      maxSize: 4,
      idleTtlMs: 1000,
      createWorker: create,
    });

    await pool.withWorker(async () => 'a');
    expect(create).toHaveBeenCalledTimes(1);
    expect(pool.size).toBe(1);

    await pool.withWorker(async () => 'b');
    // Same idle slot — no second spawn.
    expect(create).toHaveBeenCalledTimes(1);
    expect(pool.size).toBe(1);
  });

  it('spawns up to maxSize concurrent workers', async () => {
    const create = vi.fn(makeWorker);
    const pool = new ParserPool({
      maxSize: 3,
      idleTtlMs: 1000,
      createWorker: create,
    });

    let resolveA: () => void = () => {};
    let resolveB: () => void = () => {};
    let resolveC: () => void = () => {};
    const a = pool.withWorker(() => new Promise<void>((r) => (resolveA = r)));
    const b = pool.withWorker(() => new Promise<void>((r) => (resolveB = r)));
    const c = pool.withWorker(() => new Promise<void>((r) => (resolveC = r)));

    await flushMicrotasks();
    expect(create).toHaveBeenCalledTimes(3);
    expect(pool.size).toBe(3);
    expect(pool.busyCount).toBe(3);

    resolveA();
    resolveB();
    resolveC();
    await Promise.all([a, b, c]);
    expect(pool.busyCount).toBe(0);
  });

  it('queues callers when at the cap and wakes them in order on release', async () => {
    const pool = new ParserPool({
      maxSize: 1,
      idleTtlMs: 10_000,
      createWorker: makeWorker,
    });
    const order: string[] = [];

    let releaseFirst: () => void = () => {};
    const first = pool.withWorker(
      () =>
        new Promise<void>((r) => {
          releaseFirst = () => {
            order.push('first');
            r();
          };
        }),
    );
    // Both queued behind `first`.
    const second = pool.withWorker(async () => {
      order.push('second');
    });
    const third = pool.withWorker(async () => {
      order.push('third');
    });

    await flushMicrotasks();
    expect(pool.busyCount).toBe(1);

    releaseFirst();
    await Promise.all([first, second, third]);
    expect(order).toEqual(['first', 'second', 'third']);
    expect(pool.size).toBe(1); // single slot, reused
  });

  it('terminates idle worker after idleTtlMs', async () => {
    vi.useFakeTimers();
    const created: { terminate: ReturnType<typeof vi.fn> }[] = [];
    const create = () => {
      const w = makeWorker() as unknown as {
        terminate: ReturnType<typeof vi.fn>;
      };
      created.push(w);
      return w as unknown as Worker;
    };
    const pool = new ParserPool({
      maxSize: 2,
      idleTtlMs: 100,
      createWorker: create,
    });

    await pool.withWorker(async () => 'work');
    expect(pool.size).toBe(1);

    vi.advanceTimersByTime(50);
    expect(created[0]!.terminate).not.toHaveBeenCalled();
    expect(pool.size).toBe(1);

    vi.advanceTimersByTime(100);
    expect(created[0]!.terminate).toHaveBeenCalledTimes(1);
    expect(pool.size).toBe(0);

    vi.useRealTimers();
  });

  it('cancels the reap timer when the slot is reused before TTL', async () => {
    vi.useFakeTimers();
    const created: { terminate: ReturnType<typeof vi.fn> }[] = [];
    const create = () => {
      const w = makeWorker() as unknown as {
        terminate: ReturnType<typeof vi.fn>;
      };
      created.push(w);
      return w as unknown as Worker;
    };
    const pool = new ParserPool({
      maxSize: 2,
      idleTtlMs: 200,
      createWorker: create,
    });

    await pool.withWorker(async () => 'first');
    vi.advanceTimersByTime(150);
    // Reuse before TTL; reap should be cancelled.
    await pool.withWorker(async () => 'second');
    vi.advanceTimersByTime(150); // total 300, but timer was reset on reuse
    // Slot still alive: less than TTL since the second release at t=150.
    expect(pool.size).toBe(1);
    expect(created[0]!.terminate).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200); // now > TTL after the second release
    expect(pool.size).toBe(0);
    expect(created[0]!.terminate).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });
});
