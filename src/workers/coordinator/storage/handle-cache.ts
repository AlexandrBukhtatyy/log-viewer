/**
 * Weak-ref cache over `(sourceId, filePath)` → `FileSystemFileHandle`.
 *
 * `getFileHandle` traverses a directory handle every call — fine for a
 * one-shot ingest pass, expensive when the read-path resolves the same files
 * dozens of times for visible-window pagination. We hold a `WeakRef` so the
 * cache doesn't pin handles in memory; if the handle is garbage-collected
 * (e.g. `removeSource` released the reader), the cache entry is dropped on
 * the next lookup.
 */
export class HandleCache {
  private readonly cache = new Map<string, WeakRef<FileSystemFileHandle>>();

  private static key(sourceId: string, filePath: string): string {
    return `${sourceId}|${filePath}`;
  }

  get(sourceId: string, filePath: string): FileSystemFileHandle | null {
    const k = HandleCache.key(sourceId, filePath);
    const ref = this.cache.get(k);
    if (!ref) return null;
    const handle = ref.deref();
    if (!handle) {
      this.cache.delete(k);
      return null;
    }
    return handle;
  }

  set(
    sourceId: string,
    filePath: string,
    handle: FileSystemFileHandle,
  ): void {
    this.cache.set(HandleCache.key(sourceId, filePath), new WeakRef(handle));
  }

  /** Drop every entry belonging to a source — used on `removeSource`. */
  invalidate(sourceId: string): void {
    const prefix = `${sourceId}|`;
    for (const k of [...this.cache.keys()]) {
      if (k.startsWith(prefix)) this.cache.delete(k);
    }
  }

  clear(): void {
    this.cache.clear();
  }

  /** Drop entries whose `WeakRef` no longer resolves. Diagnostics use only. */
  reapDead(): number {
    let dropped = 0;
    for (const [k, ref] of this.cache) {
      if (!ref.deref()) {
        this.cache.delete(k);
        dropped++;
      }
    }
    return dropped;
  }
}
