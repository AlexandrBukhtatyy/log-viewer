import type { Database } from '@sqlite.org/sqlite-wasm';
import schemaV1Sql from './schema.sql?raw';
import schemaV2Sql from './schema-v2-fts.sql?raw';
import schemaV3Sql from './schema-v3-offsets.sql?raw';
import schemaV4Sql from './schema-v4-field-meta.sql?raw';
import schemaV5Sql from './schema-v5-line-numbers.sql?raw';

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
  {
    // v4 (ADR-0017): per-source field-schema cache. Populated by
    // `insertBatch` from Phase 2 onwards; until then the table exists but
    // stays empty, and `getFieldSchema` returns built-in attributes only.
    version: 4,
    up: (db) => {
      db.exec(schemaV4Sql);
    },
  },
  {
    // v5: add `line_number` and `file_seq` to `entry`. Non-destructive
    // ALTER TABLE — pre-existing rows keep 0 and the UI renders that as
    // "—" in the gutter / falls back to `seq` for "Open at line".
    version: 5,
    up: (db) => {
      db.exec(schemaV5Sql);
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
