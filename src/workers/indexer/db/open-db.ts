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
 * SQLite reports corruption either via `SQLITE_CORRUPT` result code 11
 * (`sqlite3_result_code() === 11`) or the textual marker
 * "database disk image is malformed". Worker termination mid-write
 * (HMR replacing the module, browser killing a stalled page, OPFS
 * crash) leaves the SAH file in this state. Catch broadly so a
 * `PRAGMA integrity_check` failure or a SQL-time exception both
 * funnel into the rebuild branch.
 */
const isCorruption = (err: unknown): boolean => {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('SQLITE_CORRUPT') ||
    msg.includes('database disk image is malformed') ||
    msg.includes('integrity_check')
  );
};

/**
 * `installOpfsSAHPoolVfs` fails with `NoModificationAllowedError` when a SAH
 * lock from a previous page (or an HMR-replaced worker) hasn't been released
 * yet. The browser drops these locks once the holder is fully GC'd, so a
 * short retry loop with backoff is enough to ride out the transient race.
 */
const RETRY_DELAYS_MS = [50, 100, 200, 400, 800, 1600] as const;
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

interface PoolUtil {
  readonly OpfsSAHPoolDb: new (filename: string) => Database;
  readonly unlink?: (filename: string) => boolean;
  readonly wipeFiles?: () => Promise<void> | void;
}

const openAndMigrate = (poolUtil: PoolUtil, filename: string): OpenedDb => {
  const db = new poolUtil.OpfsSAHPoolDb(filename);
  try {
    db.exec(
      `PRAGMA foreign_keys = ON;
       PRAGMA journal_mode = MEMORY;
       PRAGMA synchronous = NORMAL;
       PRAGMA temp_store = MEMORY;
       PRAGMA cache_size = -65000;
       PRAGMA mmap_size = 268435456;`,
    );
    // Quick smoke test BEFORE running migrations — catches a malformed
    // image early so the caller can wipe-and-retry without dragging
    // migration noise into the error path.
    const result: SqlValue[] = [];
    db.exec({
      sql: 'PRAGMA integrity_check',
      rowMode: 'array',
      callback: (row) => {
        if (Array.isArray(row) && row.length > 0) result.push(row[0]);
      },
    });
    if (result[0] !== 'ok') {
      throw new Error(
        `SQLITE_CORRUPT: PRAGMA integrity_check returned ${JSON.stringify(result)}`,
      );
    }

    installRegexpUdf(db);
    const migration = applyMigrations(db);
    return { db, migration, target: TARGET_SCHEMA_VERSION };
  } catch (err) {
    // Make sure we don't leak a half-open Database when the smoke test
    // (or migrations) trip — the caller may want to unlink and retry,
    // which needs the file released first.
    try {
      db.close();
    } catch {
      /* already closed */
    }
    throw err;
  }
};

const wipeDbFile = (poolUtil: PoolUtil, filename: string): void => {
  if (typeof poolUtil.unlink === 'function') {
    try {
      poolUtil.unlink(filename);
      return;
    } catch (err) {
      console.warn('[openDb] unlink failed, falling back to wipeFiles', err);
    }
  }
  if (typeof poolUtil.wipeFiles === 'function') {
    void poolUtil.wipeFiles();
  }
};

/**
 * Opens (or creates) the SQLite database backed by an OPFS SAH Pool VFS.
 * Must be called from a dedicated worker — OPFS is not available on main.
 *
 * SAH Pool VFS does NOT require Cross-Origin Isolation (COOP/COEP),
 * see https://sqlite.org/wasm/doc/trunk/persistence.md#vfs-opfs-sahpool
 *
 * If the on-disk image is corrupted (typically when a worker was killed
 * mid-write — e.g. HMR replacement or a tab crash), we drop the file
 * and rebuild a fresh DB. The user loses persisted state for the
 * affected source; the alternative is a permanently-broken sidebar.
 */
export const openDb = async (
  filename: string = DEFAULT_FILENAME,
): Promise<OpenedDb> => {
  const sqlite3 = await sqlite3InitModule();

  const installPool = async (): Promise<PoolUtil> => {
    for (let attempt = 0; ; attempt++) {
      try {
        // `forceReinitIfPreviouslyFailed` (undocumented in the .d.ts, lives in
        // runtime `optionDefaults`) is mandatory on retries. Without it
        // sqlite-wasm returns the cached rejected `initPromises[vfsName]` from
        // the first failed attempt and our backoff loop becomes a no-op —
        // every retry just re-throws the original SAH-lock conflict.
        const opts = {
          name: DEFAULT_VFS_NAME,
          initialCapacity: 16,
          forceReinitIfPreviouslyFailed: attempt > 0,
        } as Parameters<typeof sqlite3.installOpfsSAHPoolVfs>[0];
        return (await sqlite3.installOpfsSAHPoolVfs(opts)) as unknown as PoolUtil;
      } catch (err) {
        if (!isLockConflict(err)) throw err;
        if (attempt >= RETRY_DELAYS_MS.length) {
          // Translate the raw browser exception ("Failed to execute
          // 'createSyncAccessHandle' on 'FileSystemFileHandle'…") into
          // something a user can act on. The most common cause after this
          // many retries is another tab of the same origin still holding the
          // SAH pool open.
          throw new Error(
            'OPFS lock conflict: SQLite index is still held by another worker. ' +
              'Close other tabs of this app and reload, then try again.',
            { cause: err },
          );
        }
        await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }
  };
  const poolUtil = await installPool();

  try {
    return openAndMigrate(poolUtil, filename);
  } catch (err) {
    if (!isCorruption(err)) throw err;
    console.warn(
      '[openDb] SQLite database is corrupt — wiping and rebuilding from scratch',
      err,
    );
    wipeDbFile(poolUtil, filename);
    return openAndMigrate(poolUtil, filename);
  }
};
