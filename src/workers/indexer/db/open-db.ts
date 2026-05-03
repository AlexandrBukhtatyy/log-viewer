import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { Database } from '@sqlite.org/sqlite-wasm';
import { applyMigrations, TARGET_SCHEMA_VERSION } from './migrations.ts';

export interface OpenedDb {
  readonly db: Database;
  readonly migration: { from: number; to: number };
  readonly target: number;
}

const DEFAULT_FILENAME = '/logs.sqlite';
const DEFAULT_VFS_NAME = 'log-viewer-sahpool';

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

  const poolUtil = await sqlite3.installOpfsSAHPoolVfs({
    name: DEFAULT_VFS_NAME,
    initialCapacity: 16,
  });

  const db = new poolUtil.OpfsSAHPoolDb(filename);

  // Sane defaults; SAH Pool VFS supports MEMORY journal, which is fine for indexer workload.
  db.exec(
    `PRAGMA foreign_keys = ON;
     PRAGMA journal_mode = MEMORY;
     PRAGMA synchronous = NORMAL;
     PRAGMA temp_store = MEMORY;
     PRAGMA cache_size = -8000;`,
  );

  const migration = applyMigrations(db);

  return { db, migration, target: TARGET_SCHEMA_VERSION };
};
