import type { Database } from '@sqlite.org/sqlite-wasm';
import schemaV1Sql from './schema.sql?raw';
import schemaV2Sql from './schema-v2-fts.sql?raw';
import schemaV3Sql from './schema-v3-offsets.sql?raw';

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
  {
    // v3 (ADR-0016): switch to offset-pointer + minute-bucket index. Drops
    // FTS5 and the materialised raw/message body from `entry`. Destructive
    // by design — old rows can't be lifted to the new shape because their
    // byte positions in the source file weren't recorded. On first start
    // with v3 active, the coordinator re-ingests every persisted source.
    version: 3,
    up: (db) => {
      db.exec(schemaV3Sql);
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
