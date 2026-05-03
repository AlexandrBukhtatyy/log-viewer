import type { Database } from '@sqlite.org/sqlite-wasm';
import schemaV1Sql from './schema.sql?raw';
import schemaV2Sql from './schema-v2-fts.sql?raw';

interface Migration {
  readonly version: number;
  readonly up: (db: Database) => void;
}

const MIGRATIONS: ReadonlyArray<Migration> = [
  {
    version: 1,
    up: (db) => {
      db.exec(schemaV1Sql);
    },
  },
  {
    version: 2,
    up: (db) => {
      db.exec(schemaV2Sql);
    },
  },
];

const readUserVersion = (db: Database): number => {
  const rows = db.exec({
    sql: 'PRAGMA user_version',
    rowMode: 'array',
    returnValue: 'resultRows',
  });
  const first = rows[0] as ReadonlyArray<unknown> | undefined;
  const v = first?.[0];
  return typeof v === 'number' ? v : 0;
};

export const applyMigrations = (db: Database): { from: number; to: number } => {
  const from = readUserVersion(db);
  let current = from;

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    db.exec('BEGIN');
    try {
      migration.up(db);
      db.exec(`PRAGMA user_version = ${migration.version}`);
      db.exec('COMMIT');
      current = migration.version;
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(
        `migration v${migration.version} failed: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
  }

  return { from, to: current };
};

export const TARGET_SCHEMA_VERSION =
  MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;
