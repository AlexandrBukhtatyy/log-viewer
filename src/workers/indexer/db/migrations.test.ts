import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { Database } from '@sqlite.org/sqlite-wasm';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildClause, ORDER_BY_TIME } from '../../../core/filter/query.ts';
import { EMPTY_FILTER } from '../../../core/types/log-filter.ts';
import { applyMigrations, TARGET_SCHEMA_VERSION } from './migrations.ts';

let sqlite3Mod: Awaited<ReturnType<typeof sqlite3InitModule>> | null = null;

const init = async () => {
  if (sqlite3Mod === null) {
    sqlite3Mod = await sqlite3InitModule();
  }
  return sqlite3Mod;
};

const openMemoryDb = async (): Promise<Database> => {
  const sqlite3 = await init();
  // ':memory:' VFS — no OPFS required, works under Node test runtime.
  const db = new sqlite3.oo1.DB(':memory:');
  applyMigrations(db);
  return db;
};

const insertSource = (db: Database, id: string, kind: string, name: string) =>
  db.exec({
    sql: 'INSERT INTO source (id, kind, name) VALUES (?, ?, ?)',
    bind: [id, kind, name],
  });

/** Insert one v6 field_meta row (per source + file + key). */
const insertFieldMeta = (
  db: Database,
  sourceId: string,
  filePath: string,
  key: string,
  type = 'string',
) =>
  db.exec({
    sql: `INSERT INTO field_meta (source_id, file_path, key, type, occurrences, total_seen)
          VALUES (?, ?, ?, ?, 1, 1)`,
    bind: [sourceId, filePath, key, type],
  });

/** The exact source+file scoped read used by indexerApi.fieldMeta. */
const scopedKeys = (
  db: Database,
  sourceIds: ReadonlyArray<string>,
  filePaths: ReadonlyArray<string>,
): string[] => {
  const srcPlaceholders = sourceIds.map(() => '?').join(', ');
  const fileClause =
    filePaths.length > 0
      ? ` AND file_path IN (${filePaths.map(() => '?').join(', ')})`
      : '';
  const rows = db.exec({
    sql: `SELECT DISTINCT key FROM field_meta
           WHERE source_id IN (${srcPlaceholders})${fileClause}
           ORDER BY key`,
    bind: [...sourceIds, ...filePaths],
    rowMode: 'array',
    returnValue: 'resultRows',
  }) as unknown as ReadonlyArray<ReadonlyArray<string>>;
  return rows.map((r) => r[0] as string);
};

/**
 * Insert a pointer row into the v3 `entry` table. Body is no longer in
 * SQLite — tests pass `byteEnd - byteStart` to keep the values internally
 * consistent without forcing every caller to know the schema details.
 */
const insertEntry = (
  db: Database,
  id: string,
  sourceId: string,
  seq: number,
  ts: number | null,
  level: string,
  filePath = '',
  byteStart = 0,
  byteEnd = 10,
  fieldsJson: string | null = null,
) =>
  db.exec({
    sql: `INSERT INTO entry (id, source_id, seq, ts, level,
                             file_path, byte_start, byte_end, fields_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    bind: [
      id,
      sourceId,
      seq,
      ts,
      level,
      filePath,
      byteStart,
      byteEnd,
      fieldsJson,
    ],
  });

const readUserVersion = (db: Database): number => {
  const rows = db.exec({
    sql: 'PRAGMA user_version',
    rowMode: 'array',
    returnValue: 'resultRows',
  }) as unknown as ReadonlyArray<ReadonlyArray<number>>;
  return rows[0]?.[0] ?? 0;
};

describe('indexer/db', () => {
  beforeAll(async () => {
    await init();
  });

  describe('applyMigrations', () => {
    it('migrates fresh DB up to TARGET_SCHEMA_VERSION', async () => {
      const db = await openMemoryDb();
      expect(readUserVersion(db)).toBe(TARGET_SCHEMA_VERSION);
    });

    it('is idempotent on already-migrated DB', async () => {
      const db = await openMemoryDb();
      const before = readUserVersion(db);
      expect(() => applyMigrations(db)).not.toThrow();
      expect(readUserVersion(db)).toBe(before);
    });

    it('creates entry, source, entry_minute, and field_meta tables', async () => {
      const db = await openMemoryDb();
      const tables = db.exec({
        sql: "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
        rowMode: 'array',
        returnValue: 'resultRows',
      }) as unknown as ReadonlyArray<ReadonlyArray<string>>;
      const names = tables.map((t) => t[0]);
      expect(names).toContain('entry');
      expect(names).toContain('source');
      expect(names).toContain('entry_minute');
      expect(names).toContain('field_meta');
    });

    it('field_meta has the v4 columns and FK on source', async () => {
      const db = await openMemoryDb();
      const cols = db.exec({
        sql: 'PRAGMA table_info(field_meta)',
        rowMode: 'object',
        returnValue: 'resultRows',
      }) as unknown as ReadonlyArray<Record<string, unknown>>;
      const names = cols.map((c) => c.name as string);
      expect(names).toEqual(
        expect.arrayContaining([
          'source_id',
          'key',
          'type',
          'occurrences',
          'total_seen',
          'last_seen_at',
          'top_values_json',
        ]),
      );

      const fks = db.exec({
        sql: 'PRAGMA foreign_key_list(field_meta)',
        rowMode: 'object',
        returnValue: 'resultRows',
      }) as unknown as ReadonlyArray<Record<string, unknown>>;
      expect(fks).toHaveLength(1);
      expect(fks[0]?.table).toBe('source');
      expect(fks[0]?.from).toBe('source_id');
    });

    it('field_meta has file_path in columns and primary key (v6)', async () => {
      const db = await openMemoryDb();
      const cols = db.exec({
        sql: 'PRAGMA table_info(field_meta)',
        rowMode: 'object',
        returnValue: 'resultRows',
      }) as unknown as ReadonlyArray<Record<string, unknown>>;
      const byName = new Map(cols.map((c) => [c.name as string, c]));
      expect(byName.has('file_path')).toBe(true);
      // PK columns carry pk > 0; (source_id, file_path, key) form it.
      const pkCols = cols
        .filter((c) => Number(c.pk) > 0)
        .sort((a, b) => Number(a.pk) - Number(b.pk))
        .map((c) => c.name as string);
      expect(pkCols).toEqual(['source_id', 'file_path', 'key']);
    });

    it('field_meta keys are isolated per file within one source (v6)', async () => {
      const db = await openMemoryDb();
      insertSource(db, 's1', 'directory', 'logs');
      // app.log (plain text) contributes no field_meta rows; its siblings do.
      insertFieldMeta(db, 's1', 'mixed.log', 'trace_id');
      insertFieldMeta(db, 's1', 'mixed.log', 'level');
      insertFieldMeta(db, 's1', 'nginx.log', 'remote_addr');

      // The bug: a file tab with no own fields used to see siblings' keys.
      expect(scopedKeys(db, ['s1'], ['app.log'])).toEqual([]);
      // Each file sees only its own keys.
      expect(scopedKeys(db, ['s1'], ['mixed.log'])).toEqual([
        'level',
        'trace_id',
      ]);
      expect(scopedKeys(db, ['s1'], ['nginx.log'])).toEqual(['remote_addr']);
      // Whole-source scope (no filePaths) still unions across files.
      expect(scopedKeys(db, ['s1'], [])).toEqual([
        'level',
        'remote_addr',
        'trace_id',
      ]);
    });

    it('field_meta PK allows same key across files, conflicts within one file (v6)', async () => {
      const db = await openMemoryDb();
      insertSource(db, 's1', 'directory', 'logs');
      // Same key in two files → two distinct rows (PK includes file_path).
      insertFieldMeta(db, 's1', 'a.log', 'trace_id');
      insertFieldMeta(db, 's1', 'b.log', 'trace_id');
      const count = db.exec({
        sql: "SELECT COUNT(*) AS n FROM field_meta WHERE key = 'trace_id'",
        rowMode: 'array',
        returnValue: 'resultRows',
      }) as unknown as ReadonlyArray<ReadonlyArray<number>>;
      expect(count[0]?.[0]).toBe(2);
      // Re-inserting the same (source, file, key) violates the PK.
      expect(() => insertFieldMeta(db, 's1', 'a.log', 'trace_id')).toThrow();
    });

    it('drops entry_fts after v3 (FTS5 is retired by ADR-0016)', async () => {
      const db = await openMemoryDb();
      const tables = db.exec({
        sql: "SELECT name FROM sqlite_master WHERE name LIKE 'entry_fts%'",
        rowMode: 'array',
        returnValue: 'resultRows',
      }) as unknown as ReadonlyArray<ReadonlyArray<string>>;
      expect(tables.map((t) => t[0])).toEqual([]);
    });

    it('entry has v3 pointer columns and not raw/message', async () => {
      const db = await openMemoryDb();
      const cols = db.exec({
        sql: 'PRAGMA table_info(entry)',
        rowMode: 'object',
        returnValue: 'resultRows',
      }) as unknown as ReadonlyArray<Record<string, unknown>>;
      const names = cols.map((c) => c.name as string);
      expect(names).toEqual(
        expect.arrayContaining([
          'id',
          'source_id',
          'seq',
          'ts',
          'level',
          'file_path',
          'byte_start',
          'byte_end',
          'fields_json',
        ]),
      );
      expect(names).not.toContain('raw');
      expect(names).not.toContain('message');
    });
  });

  describe('buildClause integration', () => {
    it('level filter via WHERE IN narrows results', async () => {
      const db = await openMemoryDb();
      insertSource(db, 's1', 'file', 'a.log');
      insertEntry(db, 'e1', 's1', 0, null, 'info');
      insertEntry(db, 'e2', 's1', 1, null, 'error');
      insertEntry(db, 'e3', 's1', 2, null, 'warn');

      const { joinSql, whereSql, params } = buildClause({
        ...EMPTY_FILTER,
        levels: ['error', 'warn'],
      });
      const rows = db.exec({
        sql: `SELECT COUNT(*) AS n FROM entry ${joinSql} ${whereSql}`,
        bind: [...params],
        rowMode: 'object',
        returnValue: 'resultRows',
      }) as unknown as ReadonlyArray<Record<string, number>>;
      expect(rows[0]?.n).toBe(2);
    });

    it('free-text query stays out of SQL (resolved on the read-path)', async () => {
      // Post-ADR-0016: filter.query never produces SQL conds. The resolver
      // matches it against decoded body bytes for the visible window.
      const built = buildClause({
        ...EMPTY_FILTER,
        query: 'connection',
        queryMode: 'substring',
      });
      expect(built.joinSql).toBe('');
      // No `query`-related conds — only EMPTY_FILTER's other clauses (none).
      expect(built.whereSql).toBe('');
      expect(built.params).toEqual([]);
    });

    it('filePaths filter narrows by entry.file_path column', async () => {
      const db = await openMemoryDb();
      insertSource(db, 's1', 'directory', 'logs');
      insertEntry(
        db,
        'e1',
        's1',
        0,
        null,
        'info',
        'a.log',
        0,
        10,
        JSON.stringify({ file_path: 'a.log' }),
      );
      insertEntry(
        db,
        'e2',
        's1',
        1,
        null,
        'info',
        'b.log',
        0,
        10,
        JSON.stringify({ file_path: 'b.log' }),
      );
      const { whereSql, params } = buildClause({
        ...EMPTY_FILTER,
        filePaths: ['a.log'],
      });
      const rows = db.exec({
        sql: `SELECT entry.id AS id FROM entry ${whereSql}`,
        bind: [...params],
        rowMode: 'object',
        returnValue: 'resultRows',
      }) as unknown as ReadonlyArray<Record<string, string>>;
      expect(rows.map((r) => r.id)).toEqual(['e1']);
    });

    it('time range bounds limit by entry.ts', async () => {
      const db = await openMemoryDb();
      insertSource(db, 's1', 'file', 'a.log');
      insertEntry(db, 'e1', 's1', 0, 1000, 'info');
      insertEntry(db, 'e2', 's1', 1, 2000, 'info');
      insertEntry(db, 'e3', 's1', 2, 3000, 'info');

      const { whereSql, params } = buildClause({
        ...EMPTY_FILTER,
        timeRange: { from: 1500, to: 2500 },
      });
      const rows = db.exec({
        sql: `SELECT entry.id AS id FROM entry ${whereSql} ${ORDER_BY_TIME}`,
        bind: [...params],
        rowMode: 'object',
        returnValue: 'resultRows',
      }) as unknown as ReadonlyArray<Record<string, string>>;
      expect(rows.map((r) => r.id)).toEqual(['e2']);
    });

    it('ORDER BY puts NULL timestamps last', async () => {
      const db = await openMemoryDb();
      insertSource(db, 's1', 'file', 'a.log');
      insertEntry(db, 'e1', 's1', 0, null, 'info');
      insertEntry(db, 'e2', 's1', 1, 1000, 'info');

      const rows = db.exec({
        sql: `SELECT entry.id AS id FROM entry ${ORDER_BY_TIME}`,
        rowMode: 'object',
        returnValue: 'resultRows',
      }) as unknown as ReadonlyArray<Record<string, string>>;
      expect(rows.map((r) => r.id)).toEqual(['e2', 'e1']);
    });
  });
});
