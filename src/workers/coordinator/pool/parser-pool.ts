import * as Comlink from 'comlink';
import type { CustomParserDef } from '../../../core/parsers/custom-parser-def.ts';
import type { ParserApi } from '../../../core/rpc/parser.contract.ts';

export type ParserPriority = 'hot' | 'normal';

export interface ParserPoolOptions {
  /** Hard cap on simultaneously-spawned workers. */
  readonly maxSize: number;
  /**
   * Time a worker may sit idle before it is terminated. Pool size is allowed
   * to drop to 0 — the next `withWorker` call will spawn a fresh one.
   */
  readonly idleTtlMs: number;
  readonly createWorker: () => Worker;
}

interface PoolSlot {
  readonly worker: Worker;
  readonly proxy: Comlink.Remote<ParserApi>;
  busy: boolean;
  /** Priority of the task currently holding the slot. Meaningful only while busy. */
  priority: ParserPriority;
  lastUsedAt: number;
  /** Timer that terminates this slot if it stays idle past `idleTtlMs`. */
  reapTimer: ReturnType<typeof setTimeout> | null;
}

interface PendingRequest {
  resolve: (slot: PoolSlot) => void;
}

/**
 * Worker pool with lazy spawn + idle despawn and a two-level priority queue.
 *
 * - Workers are created only when `withWorker` (or `acquire`) is called and no
 *   idle slot is available; never on construction.
 * - When a slot is released, an idle timer is armed; if no further call comes
 *   in for `idleTtlMs`, the worker is terminated and removed from the pool.
 * - Two FIFO queues: `hotWaiters` (focus-driven, user is staring at it) and
 *   `normalWaiters` (background ingest). On release, hot is preferred — but
 *   one slot is reserved for normal whenever a normal-waiter is present so
 *   background ingest never starves under sustained hot load. The reservation
 *   degenerates to plain priority FIFO when `maxSize <= 1`.
 *
 * No minimum pool size: a system that hasn't ingested anything yet pays
 * nothing for the parser pool. First ingest after idle pays one cold start
 * (~tens of ms in dev, single-digit ms in prod).
 */
export class ParserPool {
  private readonly slots: PoolSlot[] = [];
  private readonly hotWaiters: PendingRequest[] = [];
  private readonly normalWaiters: PendingRequest[] = [];
  private busyHotCount = 0;
  private readonly options: ParserPoolOptions;
  /**
   * Pool-level mirror of the custom-parser definitions registered in
   * every worker (Phase 2.C). Updated via `loadCustomParsers`; replayed
   * to each freshly-spawned worker before it accepts its first call.
   */
  private customParsers: ReadonlyArray<CustomParserDef> = [];

  constructor(options: ParserPoolOptions) {
    this.options = options;
  }

  /**
   * Push the latest custom-parser definitions to every alive worker
   * and remember them so the next spawn picks them up. Called from
   * `coordinator.upsertCustomParser` / `removeCustomParser` /
   * `loadCustomParsers` after the IDB write completes.
   */
  async loadCustomParsers(defs: ReadonlyArray<CustomParserDef>): Promise<void> {
    this.customParsers = defs;
    if (this.slots.length === 0) return;
    await Promise.all(this.slots.map((s) => s.proxy.loadCustomParsers(defs)));
  }

  /** Number of currently-spawned workers (busy + idle). Dynamic over time. */
  get size(): number {
    return this.slots.length;
  }

  /** Subset of `size` that is currently handling a call. */
  get busyCount(): number {
    let n = 0;
    for (const s of this.slots) if (s.busy) n++;
    return n;
  }

  /**
   * Run `fn` against a parser worker proxy. The worker is acquired exclusively
   * for the duration of the call, then returned to the pool with an idle timer
   * armed. Always release; even on throw.
   *
   * `priority` defaults to `'normal'`. Pass `'hot'` for batches that belong to
   * a source/file the user is actively looking at.
   */
  async withWorker<T>(
    fn: (proxy: Comlink.Remote<ParserApi>) => Promise<T>,
    priority: ParserPriority = 'normal',
  ): Promise<T> {
    const slot = await this.acquire(priority);
    try {
      return await fn(slot.proxy);
    } finally {
      this.release(slot);
    }
  }

  /** Ping every currently-spawned worker. Returns empty array when pool is idle. */
  async pingAll(): Promise<ReadonlyArray<string>> {
    if (this.slots.length === 0) return [];
    return Promise.all(this.slots.map((s) => s.proxy.ping()));
  }

  /** Terminate every worker, drop the queue. */
  async terminate(): Promise<void> {
    for (const s of this.slots) {
      if (s.reapTimer !== null) clearTimeout(s.reapTimer);
      s.worker.terminate();
    }
    this.slots.length = 0;
    // Wake waiters with rejections by resolving with a poisoned slot would be
    // wrong; instead we leave them hanging — caller decides shutdown semantics.
    this.hotWaiters.length = 0;
    this.normalWaiters.length = 0;
    this.busyHotCount = 0;
  }

  private async acquire(priority: ParserPriority): Promise<PoolSlot> {
    // Reuse an idle slot if available.
    for (const s of this.slots) {
      if (!s.busy) {
        this.markBusy(s, priority);
        return s;
      }
    }
    // Spawn a new one if we have headroom.
    if (this.slots.length < this.options.maxSize) {
      const worker = this.options.createWorker();
      const proxy = Comlink.wrap<ParserApi>(worker);
      const slot: PoolSlot = {
        worker,
        proxy,
        busy: false,
        priority: 'normal',
        lastUsedAt: Date.now(),
        reapTimer: null,
      };
      this.slots.push(slot);
      this.markBusy(slot, priority);
      // Replay custom-parser registrations so the freshly-spawned
      // worker knows about them before its first `parse` / `detect`
      // call. Errors here are non-fatal — the worker simply won't
      // recognise that subset of parsers until the next broadcast.
      if (this.customParsers.length > 0) {
        try {
          await proxy.loadCustomParsers(this.customParsers);
        } catch (err) {
          console.warn(
            '[parser-pool] custom-parser replay failed for new worker',
            err,
          );
        }
      }
      return slot;
    }
    // Cap reached — wait for someone to release.
    const queue = priority === 'hot' ? this.hotWaiters : this.normalWaiters;
    return new Promise<PoolSlot>((resolve) => {
      queue.push({ resolve });
    });
  }

  private release(slot: PoolSlot): void {
    slot.busy = false;
    if (slot.priority === 'hot') this.busyHotCount--;
    slot.lastUsedAt = Date.now();

    // Reserved-slot rule: prefer hot, but leave one slot for normal whenever
    // a normal-waiter is present. Bypass the reservation when normal queue is
    // empty (nothing to reserve for) or when maxSize <= 1 (can't reserve at
    // all — degenerate to priority FIFO).
    const canGiveToHot =
      this.hotWaiters.length > 0 &&
      (this.busyHotCount < this.options.maxSize - 1 ||
        this.normalWaiters.length === 0 ||
        this.options.maxSize <= 1);

    if (canGiveToHot) {
      const waiter = this.hotWaiters.shift()!;
      this.markBusy(slot, 'hot');
      waiter.resolve(slot);
      return;
    }
    if (this.normalWaiters.length > 0) {
      const waiter = this.normalWaiters.shift()!;
      this.markBusy(slot, 'normal');
      waiter.resolve(slot);
      return;
    }
    this.armReap(slot);
  }

  private markBusy(slot: PoolSlot, priority: ParserPriority): void {
    slot.busy = true;
    slot.priority = priority;
    if (priority === 'hot') this.busyHotCount++;
    if (slot.reapTimer !== null) {
      clearTimeout(slot.reapTimer);
      slot.reapTimer = null;
    }
  }

  private armReap(slot: PoolSlot): void {
    if (slot.reapTimer !== null) clearTimeout(slot.reapTimer);
    slot.reapTimer = setTimeout(() => {
      // Re-check: another acquire may have grabbed the slot between schedule
      // and fire (paranoia, since markBusy clears the timer — but we may have
      // raced setTimeout's callback queue).
      if (slot.busy) return;
      const idx = this.slots.indexOf(slot);
      if (idx === -1) return;
      this.slots.splice(idx, 1);
      slot.worker.terminate();
    }, this.options.idleTtlMs);
  }
}

export const recommendedPoolSize = (): number => {
  const cores =
    (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2;
  return Math.min(Math.max(cores - 1, 1), 8);
};

export const DEFAULT_POOL_IDLE_TTL_MS = 30_000;
