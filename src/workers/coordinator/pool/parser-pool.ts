import * as Comlink from 'comlink';
import type { ParserApi } from '../../../core/rpc/parser.contract.ts';

export interface ParserPoolOptions {
  readonly size: number;
  readonly createWorker: () => Worker;
}

export class ParserPool {
  private readonly workers: Worker[];
  private readonly proxies: Comlink.Remote<ParserApi>[];
  private rr = 0;

  constructor(options: ParserPoolOptions) {
    this.workers = Array.from({ length: options.size }, () => options.createWorker());
    this.proxies = this.workers.map((w) => Comlink.wrap<ParserApi>(w));
  }

  next(): Comlink.Remote<ParserApi> {
    const proxy = this.proxies[this.rr % this.proxies.length]!;
    this.rr = (this.rr + 1) % Math.max(this.proxies.length, 1);
    return proxy;
  }

  async pingAll(): Promise<ReadonlyArray<string>> {
    return Promise.all(this.proxies.map((p) => p.ping()));
  }

  async terminate(): Promise<void> {
    this.workers.forEach((w) => w.terminate());
  }

  get size(): number {
    return this.workers.length;
  }
}

export const recommendedPoolSize = (): number => {
  const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2;
  return Math.min(Math.max(cores - 1, 1), 4);
};
