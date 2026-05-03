import type { Database, PreparedStatement, SqlValue } from '@sqlite.org/sqlite-wasm';
import { buildClause, ORDER_BY_DEFAULT } from '../../core/filter/query.ts';
import type {
  IndexedSourceRecord,
  IndexerApi,
  OpenReport,
  SizeReport,
} from '../../core/rpc/indexer.contract.ts';
import type {
  EntryId,
  LogEntry,
  LogLevel,
  LogSource,
  LogSourceKind,
  SourceId,
} from '../../core/types/index.ts';
import { openDb } from './db/open-db.ts';

const WORKER_ID = crypto.randomUUID();

interface State {
  db: Database;
  insertEntryStmt: PreparedStatement;
  bumpSourceCountStmt: PreparedStatement;
}

let state: State | null = null;

const requireState = (): State => {
  if (state === null) {
    throw new Error('indexer.open() must be called before any other operation');
  }
  return state;
};

const runRows = (
  db: Database,
  sql: string,
  bind: ReadonlyArray<SqlValue> = [],
): ReadonlyArray<Record<string, SqlValue>> =>
  db.exec({
    sql,
    bind: bind as SqlValue[],
    rowMode: 'object',
    returnValue: 'resultRows',
  }) as unknown as ReadonlyArray<Record<string, SqlValue>>;

const runScalar = (
  db: Database,
  sql: string,
  bind: ReadonlyArray<SqlValue> = [],
): SqlValue | undefined => {
  const rows = db.exec({
    sql,
    bind: bind as SqlValue[],
    rowMode: 'array',
    returnValue: 'resultRows',
  }) as unknown as ReadonlyArray<ReadonlyArray<SqlValue>>;
  return rows[0]?.[0];
};

const serializeSourceMeta = (source: LogSource): string => {
  switch (source.kind) {
    case 'file':
      return JSON.stringify({ size: source.size });
    case 'directory':
      return JSON.stringify({ glob: source.glob ?? null });
    case 'text':
      return JSON.stringify({});
    case 'url':
      return JSON.stringify({ url: source.url, headers: source.headers ?? null });
    case 'stream':
      return JSON.stringify({ transport: source.transport, url: source.url });
  }
};

const rowToIndexedSource = (
  row: Record<string, SqlValue>,
): IndexedSourceRecord => ({
  id: row.id as SourceId,
  kind: row.kind as LogSourceKind,
  name: row.name as string,
  metaJson: (row.meta_json as string | null) ?? null,
  indexedAt: (row.indexed_at as number | null) ?? null,
  entryCount: Number(row.entry_count ?? 0),
});

const parseFields = (raw: SqlValue | null | undefined): Readonly<Record<string, unknown>> => {
  if (typeof raw !== 'string' || raw === '') return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* corrupt fields_json — treat as empty */
  }
  return {};
};

const rowToEntry = (row: Record<string, SqlValue>): LogEntry => ({
  id: row.id as EntryId,
  sourceId: row.source_id as SourceId,
  seq: Number(row.seq),
  timestamp: (row.ts as number | null) ?? null,
  level: row.level as LogLevel,
  message: row.message as string,
  raw: row.raw as string,
  fields: parseFields(row.fields_json),
});

const ENTRY_COLS_UNQUALIFIED =
  'id, source_id, seq, ts, level, message, raw, fields_json';
/** Qualified with `entry.` prefix to disambiguate from `entry_fts` in FTS JOIN queries.
 *  Aliases ensure result-row keys are stable regardless of driver behavior. */
const ENTRY_COLS_SELECT =
  'entry.id AS id, entry.source_id AS source_id, entry.seq AS seq, ' +
  'entry.ts AS ts, entry.level AS level, entry.message AS message, ' +
  'entry.raw AS raw, entry.fields_json AS fields_json';

const INSERT_ENTRY_SQL = `
  INSERT OR IGNORE INTO entry (${ENTRY_COLS_UNQUALIFIED})
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`;

const BUMP_SOURCE_COUNT_SQL = `
  UPDATE source SET entry_count = entry_count + ?, indexed_at = ? WHERE id = ?
`;

export const indexerApi: IndexerApi = {
  ping: async () => `indexer-worker:${WORKER_ID}`,

  open: async (): Promise<OpenReport> => {
    if (state !== null) {
      return {
        migrationFrom: 0,
        migrationTo: 0,
        target: 0,
      };
    }
    const opened = await openDb();
    state = {
      db: opened.db,
      insertEntryStmt: opened.db.prepare(INSERT_ENTRY_SQL),
      bumpSourceCountStmt: opened.db.prepare(BUMP_SOURCE_COUNT_SQL),
    };
    return {
      migrationFrom: opened.migration.from,
      migrationTo: opened.migration.to,
      target: opened.target,
    };
  },

  close: async () => {
    if (state === null) return;
    state.insertEntryStmt.finalize();
    state.bumpSourceCountStmt.finalize();
    state.db.close();
    state = null;
  },

  upsertSource: async (source) => {
    const { db } = requireState();
    db.exec({
      sql: `
        INSERT INTO source (id, kind, name, meta_json, indexed_at, entry_count)
        VALUES (?, ?, ?, ?, ?, 0)
        ON CONFLICT(id) DO UPDATE SET
          kind       = excluded.kind,
          name       = excluded.name,
          meta_json  = excluded.meta_json,
          indexed_at = excluded.indexed_at
      `,
      bind: [source.id, source.kind, source.name, serializeSourceMeta(source), Date.now()],
    });
  },

  removeSource: async (id) => {
    const { db } = requireState();
    db.exec({ sql: 'DELETE FROM source WHERE id = ?', bind: [id] });
  },

  listSources: async () => {
    const { db } = requireState();
    const rows = runRows(
      db,
      `SELECT id, kind, name, meta_json, indexed_at, entry_count
         FROM source
        ORDER BY indexed_at IS NULL, indexed_at DESC, name ASC`,
    );
    return rows.map(rowToIndexedSource);
  },

  insertBatch: async (entries) => {
    if (entries.length === 0) return;
    const { db, insertEntryStmt, bumpSourceCountStmt } = requireState();

    db.exec('BEGIN');
    try {
      for (const e of entries) {
        insertEntryStmt
          .bind([
            e.id,
            e.sourceId,
            e.seq,
            e.timestamp,
            e.level,
            e.message,
            e.raw,
            JSON.stringify(e.fields),
          ])
          .step();
        insertEntryStmt.reset();
      }

      const counts = new Map<SourceId, number>();
      for (const e of entries) {
        counts.set(e.sourceId, (counts.get(e.sourceId) ?? 0) + 1);
      }
      const now = Date.now();
      for (const [sid, n] of counts) {
        bumpSourceCountStmt.bind([n, now, sid]).step();
        bumpSourceCountStmt.reset();
      }

      db.exec('COMMIT');
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* ignore rollback errors — primary error wins */
      }
      throw err;
    }
  },

  search: async (filter, from, to) => {
    const { db } = requireState();
    const { joinSql, whereSql, params } = buildClause(filter);
    const limit = Math.max(0, to - from);
    const offset = Math.max(0, from);
    if (limit === 0) return [];
    const sql = `SELECT ${ENTRY_COLS_SELECT} FROM entry ${joinSql} ${whereSql} ${ORDER_BY_DEFAULT} LIMIT ? OFFSET ?`;
    const rows = runRows(db, sql, [...params, limit, offset]);
    return rows.map(rowToEntry);
  },

  count: async (filter) => {
    const { db } = requireState();
    const { joinSql, whereSql, params } = buildClause(filter);
    const v = runScalar(db, `SELECT COUNT(*) FROM entry ${joinSql} ${whereSql}`, params);
    return typeof v === 'number' ? v : Number(v ?? 0);
  },

  getEntry: async (id) => {
    const { db } = requireState();
    const rows = runRows(
      db,
      `SELECT ${ENTRY_COLS_SELECT} FROM entry WHERE id = ?`,
      [id],
    );
    return rows.length === 0 ? null : rowToEntry(rows[0]!);
  },

  vacuum: async () => {
    const { db } = requireState();
    db.exec('VACUUM');
  },

  estimateSize: async (): Promise<SizeReport> => {
    const { db } = requireState();
    const pageCount = runScalar(db, 'PRAGMA page_count');
    const pageSize = runScalar(db, 'PRAGMA page_size');
    const total = Number(pageCount ?? 0) * Number(pageSize ?? 0);
    const perRows = runRows(
      db,
      `SELECT source_id,
              SUM(LENGTH(raw) + LENGTH(message) + IFNULL(LENGTH(fields_json), 0)) AS bytes
         FROM entry
        GROUP BY source_id`,
    );
    return {
      total,
      perSource: perRows.map((r) => ({
        id: r.source_id as SourceId,
        bytes: Number(r.bytes ?? 0),
      })),
    };
  },

  clearAll: async () => {
    const { db } = requireState();
    db.exec('DELETE FROM source');
    db.exec('DELETE FROM entry');
  },
};
