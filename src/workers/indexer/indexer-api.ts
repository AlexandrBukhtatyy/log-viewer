import type { Database, PreparedStatement, SqlValue } from '@sqlite.org/sqlite-wasm';
import { buildClause, ORDER_BY_DEFAULT } from '../../core/filter/query.ts';
import { buildCsv, buildJsonl } from '../../core/util/export.ts';
import type {
  GroupBucket,
  HistogramBucket,
  HistogramResponse,
} from '../../core/rpc/coordinator.contract.ts';
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
import { collectLevelCounts, groupFieldExpr, levelBreakdownSql } from './aggregate.ts';
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
      return JSON.stringify({
        glob: source.glob ?? null,
        watch: source.watch ?? false,
      });
    case 'text':
      return JSON.stringify({});
    case 'url':
      return JSON.stringify({ url: source.url, headers: source.headers ?? null });
    case 'stream':
      return JSON.stringify({ transport: source.transport, url: source.url });
    case 'remote-ssh':
      return JSON.stringify({
        host: source.host,
        user: source.user ?? null,
        paths: source.paths ?? null,
      });
    case 'cloud':
      return JSON.stringify({
        provider: source.provider,
        query: source.query ?? null,
        region: source.region ?? null,
      });
    case 'k8s':
      return JSON.stringify({
        cluster: source.cluster,
        namespace: source.namespace ?? null,
        pod: source.pod ?? null,
        container: source.container ?? null,
      });
    case 'bus':
      return JSON.stringify({
        broker: source.broker,
        topic: source.topic,
        group: source.group ?? null,
      });
    case 'db':
      return JSON.stringify({
        dialect: source.dialect,
        url: source.url,
        query: source.query,
      });
    case 'snapshot':
      // archive (File) is not serializable; only persist name.
      return JSON.stringify({});
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

  groupCounts: async (filter, field, limit): Promise<ReadonlyArray<GroupBucket>> => {
    const { db } = requireState();
    const { joinSql, whereSql, params } = buildClause(filter);
    const expr = groupFieldExpr(field);
    const cap = Math.max(1, Math.min(10000, limit ?? 1000));
    const lvl = levelBreakdownSql();
    const sql =
      `SELECT ${expr} AS gv, ` +
      `COUNT(*) AS cnt, ` +
      `MIN(entry.ts) AS ts_min, ` +
      `MAX(entry.ts) AS ts_max, ` +
      `${lvl.columns} ` +
      `FROM entry ${joinSql} ${whereSql} ` +
      `GROUP BY ${expr} ` +
      `ORDER BY cnt DESC, gv ASC ` +
      `LIMIT ?`;
    const rows = runRows(db, sql, [...params, ...lvl.binds, cap]);
    return rows.map((r): GroupBucket => {
      const v = r.gv;
      return {
        value: v === null || v === undefined ? null : String(v),
        count: Number(r.cnt ?? 0),
        tsMin: (r.ts_min as number | null) ?? null,
        tsMax: (r.ts_max as number | null) ?? null,
        levelCounts: collectLevelCounts(r),
      };
    });
  },

  histogram: async (filter, bucketCount): Promise<HistogramResponse> => {
    const { db } = requireState();
    const buckets = Math.max(1, Math.min(1000, Math.floor(bucketCount)));
    const { joinSql, whereSql, params } = buildClause(filter);

    const tsWhere = whereSql === '' ? 'WHERE entry.ts IS NOT NULL' : `${whereSql} AND entry.ts IS NOT NULL`;

    const tr = filter.timeRange;
    let from: number | null = tr ? tr.from : null;
    let to: number | null = tr ? tr.to : null;
    if (from === null || to === null) {
      const rangeRow = runRows(
        db,
        `SELECT MIN(entry.ts) AS lo, MAX(entry.ts) AS hi FROM entry ${joinSql} ${tsWhere}`,
        params,
      );
      const lo = (rangeRow[0]?.lo as number | null) ?? null;
      const hi = (rangeRow[0]?.hi as number | null) ?? null;
      if (from === null) from = lo;
      if (to === null) to = hi;
    }
    if (from === null || to === null || to <= from) {
      return { buckets: [], range: from !== null && to !== null ? { from, to } : null };
    }

    const span = to - from;
    const bucketSize = span / buckets;
    const lvl = levelBreakdownSql();
    // bucket index = MIN(buckets-1, FLOOR((ts - from) / bucketSize)) — clamps the "to" edge into the last bucket.
    const idxExpr = `MIN(?, CAST((entry.ts - ?) / ? AS INTEGER))`;
    const sql =
      `SELECT ${idxExpr} AS bidx, ` +
      `COUNT(*) AS cnt, ` +
      `${lvl.columns} ` +
      `FROM entry ${joinSql} ${tsWhere} AND entry.ts >= ? AND entry.ts <= ? ` +
      `GROUP BY bidx ORDER BY bidx ASC`;
    const bind: SqlValue[] = [
      buckets - 1,
      from,
      bucketSize === 0 ? 1 : bucketSize,
      ...params,
      from,
      to,
      ...lvl.binds,
    ];
    const rows = runRows(db, sql, bind);
    const byIdx = new Map<number, Record<string, SqlValue>>();
    for (const r of rows) byIdx.set(Number(r.bidx ?? 0), r);

    const out: HistogramBucket[] = [];
    for (let i = 0; i < buckets; i++) {
      const tsFrom = from + i * bucketSize;
      const tsTo = i === buckets - 1 ? to : from + (i + 1) * bucketSize;
      const r = byIdx.get(i);
      out.push({
        tsFrom,
        tsTo,
        count: r ? Number(r.cnt ?? 0) : 0,
        levelCounts: r ? collectLevelCounts(r) : {},
      });
    }
    return { buckets: out, range: { from, to } };
  },

  exportFiltered: async (filter, format) => {
    const { db } = requireState();
    const { joinSql, whereSql, params } = buildClause(filter);
    const sql =
      `SELECT ${ENTRY_COLS_SELECT} FROM entry ${joinSql} ${whereSql} ${ORDER_BY_DEFAULT}`;
    const rows = runRows(db, sql, params);
    const entries = rows.map(rowToEntry);
    return format === 'csv' ? buildCsv(entries) : buildJsonl(entries);
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
