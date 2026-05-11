import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { Database, SqlValue } from '@sqlite.org/sqlite-wasm';
import { applyMigrations, TARGET_SCHEMA_VERSION } from './migrations.ts';

export interface OpenedDb {
  readonly db: Database;
  readonly migration: { from: number; to: number };
  readonly target: number;
}

const DEFAULT_FILENAME = '/logs.sqlite';
const DEFAULT_VFS_NAME = 'log-viewer-sahpool';

/**
 * Register JS-backed REGEXP UDFs so SQL `column REGEXP ?` works, plus a
 * case-insensitive twin `regexpi(pattern, text)` for caseSensitive=false.
 *
 * Compiled `RegExp`s are cached by `flags|pattern` so repeated row-tests
 * don't re-compile. Invalid patterns return 0 (no match) — keeps the wider
 * query alive instead of surfacing a SQL exception for a typo in the search
 * box.
 *
 * Used by query.ts for `queryMode='regex'` and for the substring `wholeWord`
 * upgrade (`\b…\b`).
 */
const installRegexpUdf = (db: Database): void => {
  const cache = new Map<string, RegExp | null>();
  const compile = (pattern: string, flags: string): RegExp | null => {
    const key = `${flags}|${pattern}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    let re: RegExp | null;
    try {
      re = new RegExp(pattern, flags);
    } catch {
      re = null;
    }
    cache.set(key, re);
    return re;
  };

  const matcher = (flags: string) =>
    (_ctxPtr: number, ...values: SqlValue[]): SqlValue => {
      const [pattern, text] = values;
      if (typeof pattern !== 'string' || typeof text !== 'string') return 0;
      const re = compile(pattern, flags);
      if (re === null) return 0;
      return re.test(text) ? 1 : 0;
    };

  db.createFunction('regexp', matcher(''), {
    arity: 2,
    deterministic: true,
    innocuous: true,
  });
  db.createFunction('regexpi', matcher('i'), {
    arity: 2,
    deterministic: true,
    innocuous: true,
  });
};

const isLockConflict = (err: unknown): boolean =>
  err instanceof DOMException && err.name === 'NoModificationAllowedError';

/**
 * `installOpfsSAHPoolVfs` fails with `NoModificationAllowedError` when a SAH
 * lock from a previous page (or an HMR-replaced worker) hasn't been released
 * yet. The browser drops these locks once the holder is fully GC'd, so a
 * short retry loop with backoff is enough to ride out the transient race.
 */
const RETRY_DELAYS_MS = [50, 100, 200, 400, 800, 1600] as const;
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Opens (or creates) the SQLite database backed by an OPFS SAH Pool VFS.
 * Must be called from a dedicated worker — OPFS is not available on main.
 *
 * SAH Pool VFS does NOT require Cross-Origin Isolation (COOP/COEP),
 * see https://sqlite.org/wasm/doc/trunk/persistence.md#vfs-opfs-sahpool
 */
export const openDb = async (
  filename: string = DEFAULT_FILENAME,
): Promise<OpenedDb> => {
  const sqlite3 = await sqlite3InitModule();

  const installPool = async (): Promise<
    Awaited<ReturnType<typeof sqlite3.installOpfsSAHPoolVfs>>
  > => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await sqlite3.installOpfsSAHPoolVfs({
          name: DEFAULT_VFS_NAME,
          initialCapacity: 16,
        });
      } catch (err) {
        if (!isLockConflict(err) || attempt >= RETRY_DELAYS_MS.length) throw err;
        await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }
  };
  const poolUtil = await installPool();

  const db = new poolUtil.OpfsSAHPoolDb(filename);

  // Sane defaults; SAH Pool VFS supports MEMORY journal, which is fine for indexer workload.
  db.exec(
    `PRAGMA foreign_keys = ON;
     PRAGMA journal_mode = MEMORY;
     PRAGMA synchronous = NORMAL;
     PRAGMA temp_store = MEMORY;
     PRAGMA cache_size = -8000;`,
  );

  installRegexpUdf(db);

  const migration = applyMigrations(db);

  return { db, migration, target: TARGET_SCHEMA_VERSION };
};
