import type { Database, PreparedStatement, SqlValue } from '@sqlite.org/sqlite-wasm';
import { buildClause, orderByForFilter } from '../../core/filter/query.ts';
import { SOURCE_JOIN_SQL } from '../../core/filter/field-key.ts';
import { buildCsv, buildJsonl } from '../../core/util/export.ts';
import type {
  GroupBucket,
  HistogramBucket,
  HistogramResponse,
} from '../../core/rpc/coordinator.contract.ts';
import type {
  IndexedSourceRecord,
  IndexerApi,
  LogicalFieldCoverage,
  LogicalFieldCoverageSource,
  OpenReport,
  SizeReport,
} from '../../core/rpc/indexer.contract.ts';
import type { FieldDescriptor } from '../../core/filter/field-descriptor.ts';
import type {
  EntryId,
  LogEntry,
  LogLevel,
  LogSource,
  LogSourceKind,
  LogicalField,
  SourceId,
} from '../../core/types/index.ts';
import { collectLevelCounts, groupFieldExpr, levelBreakdownSql } from './aggregate.ts';
import { extractorToSqlOrNull } from '../../core/logical-fields/sql.ts';
import { openDb } from './db/open-db.ts';
import {
  aggregateFieldDescriptors,
  aggregateFieldMeta,
  type FieldMetaRow,
  type FieldType,
  mergeFieldType,
  mergeTopValues,
} from './field-meta.ts';

const WORKER_ID = crypto.randomUUID();

interface State {
  db: Database;
  insertEntryBulkStmt: PreparedStatement;
  bumpSourceCountStmt: PreparedStatement;
  upsertMinuteStmt: PreparedStatement;
  upsertFieldMetaStmt: PreparedStatement;
}


interface MinuteBucket {
  readonly sourceId: SourceId;
  readonly filePath: string;
  readonly minuteBucket: number;
  byteStart: number;
  byteEnd: number;
  entryCount: number;
  levelDist: Record<string, number>;
}

const aggregateMinuteBuckets = (
  entries: ReadonlyArray<LogEntry>,
): ReadonlyArray<MinuteBucket> => {
  const map = new Map<string, MinuteBucket>();
  for (const e of entries) {
    if (e.timestamp === null) continue; // entries without ts don't aggregate
    const minuteBucket = Math.floor(e.timestamp / 60000);
    const key = `${e.sourceId}|${e.filePath}|${minuteBucket}`;
    const existing = map.get(key);
    if (existing === undefined) {
      map.set(key, {
        sourceId: e.sourceId,
        filePath: e.filePath,
        minuteBucket,
        byteStart: e.byteStart,
        byteEnd: e.byteEnd,
        entryCount: 1,
        levelDist: { [e.level]: 1 },
      });
      continue;
    }
    if (e.byteStart < existing.byteStart) existing.byteStart = e.byteStart;
    if (e.byteEnd > existing.byteEnd) existing.byteEnd = e.byteEnd;
    existing.entryCount += 1;
    existing.levelDist[e.level] = (existing.levelDist[e.level] ?? 0) + 1;
  }
  return [...map.values()];
};

let state: State | null = null;

/**
 * Latest activated logical fields pushed by the main thread (ADR-0030).
 * Snapshot is consulted by every SQL builder that may encounter a
 * `~name` key; an empty array (the default) makes such keys compile
 * to SQL `NULL`, matching the read-path resolver behaviour.
 */
let activeLogicalFields: ReadonlyArray<LogicalField> = [];
const logicalCtx = (): { activeLogicalFields: ReadonlyArray<LogicalField> } =>
  ({ activeLogicalFields });

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
  // `parserId` (Phase 2.B) is persisted alongside the kind-specific
  // payload for the source kinds whose ingestion actually consults a
  // parser. It survives reload and is restored in `hydratePersisted`.
  const withParser = (
    payload: Record<string, unknown>,
    parserId?: string,
  ): Record<string, unknown> =>
    parserId ? { ...payload, parserId } : payload;
  switch (source.kind) {
    case 'file':
      return JSON.stringify(withParser({ size: source.size }, source.parserId));
    case 'directory':
      return JSON.stringify(
        withParser(
          {
            glob: source.glob ?? null,
            watch: source.watch ?? false,
          },
          source.parserId,
        ),
      );
    case 'text':
      return JSON.stringify(withParser({}, source.parserId));
    case 'url':
      return JSON.stringify(
        withParser(
          { url: source.url, headers: source.headers ?? null },
          source.parserId,
        ),
      );
    case 'stream':
      return JSON.stringify(
        withParser(
          { transport: source.transport, url: source.url },
          source.parserId,
        ),
      );
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

/**
 * Convert a row from `entry` (schema v3 — pointer-only) into a `LogEntry`
 * shell. `raw` and `message` are blank — the lazy-resolver in the
 * coordinator slices them out of the source's blob storage at read time
 * (ADR-0016). The shell shape stays the same as before so UI consumers
 * keep working unchanged.
 */
const rowToEntry = (row: Record<string, SqlValue>): LogEntry => ({
  id: row.id as EntryId,
  sourceId: row.source_id as SourceId,
  seq: Number(row.seq),
  timestamp: (row.ts as number | null) ?? null,
  level: row.level as LogLevel,
  message: '',
  raw: '',
  fields: parseFields(row.fields_json),
  filePath: (row.file_path as string | null) ?? '',
  byteStart: Number(row.byte_start ?? 0),
  byteEnd: Number(row.byte_end ?? 0),
  lineNumber: Number(row.line_number ?? 0),
  fileSeq: Number(row.file_seq ?? 0),
});

const ENTRY_COLS_UNQUALIFIED =
  'id, source_id, seq, ts, level, file_path, byte_start, byte_end, ' +
  'line_number, file_seq, fields_json';
const ENTRY_COLS_SELECT =
  'entry.id AS id, entry.source_id AS source_id, entry.seq AS seq, ' +
  'entry.ts AS ts, entry.level AS level, ' +
  'entry.file_path AS file_path, entry.byte_start AS byte_start, ' +
  'entry.byte_end AS byte_end, entry.line_number AS line_number, ' +
  'entry.file_seq AS file_seq, entry.fields_json AS fields_json';

// Multi-row INSERT cuts JS↔WASM round-trips on hot ingest. Bind cap = rows ×
// 11 cols; SQLITE_MAX_VARIABLE_NUMBER is 32766, so 256 × 11 = 2816 is safe.
const ROWS_PER_BULK_INSERT = 256;
const buildBulkInsertEntrySql = (rows: number): string => {
  const tuple = '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
  const placeholders = new Array<string>(rows).fill(tuple).join(', ');
  return `INSERT OR IGNORE INTO entry (${ENTRY_COLS_UNQUALIFIED}) VALUES ${placeholders}`;
};
const INSERT_ENTRY_BULK_SQL = buildBulkInsertEntrySql(ROWS_PER_BULK_INSERT);

/**
 * UPSERT into `entry_minute` — one row per (source, file, minute_bucket).
 * Aggregates are computed by the orchestrator before this call: per-bucket
 * entry_count, byte_start (min), byte_end (max), level_dist (object).
 */
const UPSERT_MINUTE_SQL = `
  INSERT INTO entry_minute (source_id, file_path, minute_bucket,
                            byte_start, byte_end, entry_count, level_dist_json)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(source_id, file_path, minute_bucket) DO UPDATE SET
    byte_start      = MIN(byte_start, excluded.byte_start),
    byte_end        = MAX(byte_end,   excluded.byte_end),
    entry_count     = entry_count + excluded.entry_count,
    level_dist_json = excluded.level_dist_json
`;

/**
 * UPSERT into `field_meta` — one row per (source, key). Type and top-values
 * merging is done in JS (loaded from existing row before bind) since SQLite
 * UPSERT can't easily do a JSON-array merge with cap-K. The bind already
 * carries the merged values.
 */
const UPSERT_FIELD_META_SQL = `
  INSERT INTO field_meta (source_id, key, type, occurrences, total_seen,
                          last_seen_at, top_values_json)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(source_id, key) DO UPDATE SET
    type            = excluded.type,
    occurrences     = excluded.occurrences,
    total_seen      = excluded.total_seen,
    last_seen_at    = excluded.last_seen_at,
    top_values_json = excluded.top_values_json
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
      insertEntryBulkStmt: opened.db.prepare(INSERT_ENTRY_BULK_SQL),
      bumpSourceCountStmt: opened.db.prepare(BUMP_SOURCE_COUNT_SQL),
      upsertMinuteStmt: opened.db.prepare(UPSERT_MINUTE_SQL),
      upsertFieldMetaStmt: opened.db.prepare(UPSERT_FIELD_META_SQL),
    };
    return {
      migrationFrom: opened.migration.from,
      migrationTo: opened.migration.to,
      target: opened.target,
    };
  },

  close: async () => {
    if (state === null) return;
    state.insertEntryBulkStmt.finalize();
    state.bumpSourceCountStmt.finalize();
    state.upsertMinuteStmt.finalize();
    state.upsertFieldMetaStmt.finalize();
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
    const {
      db,
      insertEntryBulkStmt,
      bumpSourceCountStmt,
      upsertMinuteStmt,
      upsertFieldMetaStmt,
    } = requireState();

    const pushEntryParams = (e: LogEntry, sink: SqlValue[]): void => {
      sink.push(
        e.id,
        e.sourceId,
        e.seq,
        e.timestamp,
        e.level,
        e.filePath,
        e.byteStart,
        e.byteEnd,
        e.lineNumber,
        e.fileSeq,
        // Ingest path: parser-worker pre-serialized fieldsJson in parallel.
        // Fallback covers entries built outside the parser (tests / fixtures).
        e.fieldsJson ?? JSON.stringify(e.fields),
      );
    };

    db.exec('BEGIN');
    try {
      // Bulk INSERT in chunks of ROWS_PER_BULK_INSERT using the prepared
      // statement; the trailing remainder (< ROWS_PER_BULK_INSERT) goes
      // through a one-shot exec with a SQL string sized to fit it.
      const fullChunks = Math.floor(entries.length / ROWS_PER_BULK_INSERT);
      for (let c = 0; c < fullChunks; c++) {
        const off = c * ROWS_PER_BULK_INSERT;
        const params: SqlValue[] = [];
        for (let i = 0; i < ROWS_PER_BULK_INSERT; i++) {
          pushEntryParams(entries[off + i], params);
        }
        insertEntryBulkStmt.bind(params).step();
        insertEntryBulkStmt.reset();
      }
      const remainder = entries.length - fullChunks * ROWS_PER_BULK_INSERT;
      if (remainder > 0) {
        const off = fullChunks * ROWS_PER_BULK_INSERT;
        const params: SqlValue[] = [];
        for (let i = 0; i < remainder; i++) {
          pushEntryParams(entries[off + i], params);
        }
        db.exec({ sql: buildBulkInsertEntrySql(remainder), bind: params });
      }

      // Per-source row counters.
      const counts = new Map<SourceId, number>();
      for (const e of entries) {
        counts.set(e.sourceId, (counts.get(e.sourceId) ?? 0) + 1);
      }
      const now = Date.now();
      for (const [sid, n] of counts) {
        bumpSourceCountStmt.bind([n, now, sid]).step();
        bumpSourceCountStmt.reset();
      }

      // Aggregate per (source, file, minute) — drives the timeline /
      // first-paint without scanning entry rows. Computed in JS and
      // UPSERTed in one loop to stay cheap on hot batches.
      const buckets = aggregateMinuteBuckets(entries);
      for (const b of buckets) {
        upsertMinuteStmt
          .bind([
            b.sourceId,
            b.filePath,
            b.minuteBucket,
            b.byteStart,
            b.byteEnd,
            b.entryCount,
            JSON.stringify(b.levelDist),
          ])
          .step();
        upsertMinuteStmt.reset();
      }

      // Update per-(source, key) field schema cache so the column /
      // group-by / filter pickers can serve their lists without scanning
      // `entry.fields_json`. One bulk SELECT loads existing rows for
      // every (source, key) pair touched by this batch; merging
      // (type, top values) is done in JS; UPSERT below carries the merged
      // result.
      const fieldsBySource = aggregateFieldMeta(entries);
      const allPairs: Array<{ sourceId: SourceId; key: string }> = [];
      for (const [sid, perKey] of fieldsBySource) {
        for (const key of perKey.keys()) allPairs.push({ sourceId: sid, key });
      }
      const existingBySidKey = new Map<
        string,
        { type: FieldType; occurrences: number; totalSeen: number; topValuesJson: string | null }
      >();
      // Chunk pair lookups to stay under SQLITE_MAX_VARIABLE_NUMBER
      // (1000 pairs × 2 params = 2000, comfortably below the 32k cap).
      const PAIRS_PER_LOOKUP = 1000;
      for (let i = 0; i < allPairs.length; i += PAIRS_PER_LOOKUP) {
        const slice = allPairs.slice(i, i + PAIRS_PER_LOOKUP);
        const conds = slice.map(() => '(source_id = ? AND key = ?)').join(' OR ');
        const params: SqlValue[] = [];
        for (const p of slice) {
          params.push(p.sourceId);
          params.push(p.key);
        }
        const rows = runRows(
          db,
          `SELECT source_id, key, type, occurrences, total_seen, top_values_json
             FROM field_meta
            WHERE ${conds}`,
          params,
        );
        for (const r of rows) {
          const k = `${r.source_id as string}\x00${r.key as string}`;
          existingBySidKey.set(k, {
            type: r.type as FieldType,
            occurrences: Number(r.occurrences ?? 0),
            totalSeen: Number(r.total_seen ?? 0),
            topValuesJson: (r.top_values_json as string | null) ?? null,
          });
        }
      }
      for (const [sid, perKey] of fieldsBySource) {
        if (perKey.size === 0) continue;
        const totalSeenIncr = counts.get(sid) ?? 0;
        for (const [key, accum] of perKey) {
          const prev = existingBySidKey.get(`${sid}\x00${key}`);
          const mergedType = mergeFieldType(prev?.type ?? null, accum.types);
          const mergedTopVals = mergeTopValues(
            prev?.topValuesJson ?? null,
            accum.topVals,
          );
          upsertFieldMetaStmt
            .bind([
              sid,
              key,
              mergedType,
              accum.occurrences + (prev?.occurrences ?? 0),
              totalSeenIncr + (prev?.totalSeen ?? 0),
              now,
              JSON.stringify(mergedTopVals),
            ])
            .step();
          upsertFieldMetaStmt.reset();
        }
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
    const { joinSql, whereSql, params } = buildClause(filter, logicalCtx());
    const limit = Math.max(0, to - from);
    const offset = Math.max(0, from);
    if (limit === 0) return [];
    const sql = `SELECT ${ENTRY_COLS_SELECT} FROM entry ${joinSql} ${whereSql} ${orderByForFilter(filter)} LIMIT ? OFFSET ?`;
    const rows = runRows(db, sql, [...params, limit, offset]);
    return rows.map(rowToEntry);
  },

  count: async (filter) => {
    const { db } = requireState();
    const { joinSql, whereSql, params } = buildClause(filter, logicalCtx());
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
    const { joinSql: filterJoin, whereSql, params } = buildClause(filter, logicalCtx());
    const { sql: expr, needsSourceJoin: groupNeedsJoin } = groupFieldExpr(field, logicalCtx());
    // SOURCE_JOIN_SQL is the only JOIN today; merge to avoid duplicating it.
    const joinSql = (filterJoin === SOURCE_JOIN_SQL || groupNeedsJoin)
      ? SOURCE_JOIN_SQL
      : '';
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
    // `?` placeholders in SQL appear in this order:
    //   1. lvl.columns (7 ?'s in the SELECT)
    //   2. whereSql params
    //   3. LIMIT ?
    // Bind in the same order — getting it wrong is silent (lvl.binds
    // bleeding into WHERE and vice versa makes every match look false).
    const rows = runRows(db, sql, [...lvl.binds, ...params, cap]);
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
    const { joinSql, whereSql, params } = buildClause(filter, logicalCtx());

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
    // `?` placeholders in SQL appear in this order:
    //   1. MIN(?, ...) — `buckets - 1`
    //   2. `(entry.ts - ?)` — `from`
    //   3. `/ ?` — bucketSize
    //   4. lvl.columns (7 ?'s)
    //   5. whereSql params
    //   6. `entry.ts >= ?` — from
    //   7. `entry.ts <= ?` — to
    // Bind in the same order.
    const bind: SqlValue[] = [
      buckets - 1,
      from,
      bucketSize === 0 ? 1 : bucketSize,
      ...lvl.binds,
      ...params,
      from,
      to,
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

  fieldMeta: async (sourceIds): Promise<ReadonlyArray<FieldDescriptor>> => {
    if (sourceIds.length === 0) return [];
    const { db } = requireState();
    const placeholders = sourceIds.map(() => '?').join(', ');
    const rows = runRows(
      db,
      `SELECT source_id, key, type, occurrences, total_seen, top_values_json
         FROM field_meta
        WHERE source_id IN (${placeholders})`,
      sourceIds as ReadonlyArray<SqlValue>,
    );
    return aggregateFieldDescriptors(
      rows.map((r): FieldMetaRow => ({
        source_id: String(r.source_id ?? ''),
        key: String(r.key ?? ''),
        type: String(r.type ?? ''),
        occurrences: r.occurrences as number | null,
        total_seen: r.total_seen as number | null,
        top_values_json: r.top_values_json as string | null,
      })),
    );
  },

  exportFiltered: async (filter, format) => {
    const { db } = requireState();
    const { joinSql, whereSql, params } = buildClause(filter, logicalCtx());
    const sql =
      `SELECT ${ENTRY_COLS_SELECT} FROM entry ${joinSql} ${whereSql} ${orderByForFilter(filter)}`;
    const rows = runRows(db, sql, params);
    const entries = rows.map(rowToEntry);
    return format === 'csv' ? buildCsv(entries) : buildJsonl(entries);
  },

  setLogicalFields: async (fields) => {
    activeLogicalFields = fields;
  },

  logicalFieldCoverage: async (field): Promise<LogicalFieldCoverage> => {
    const { db } = requireState();

    // Per-source totals — single pass over the index.
    const totalsRows = runRows(
      db,
      'SELECT source_id, COUNT(*) AS cnt FROM entry GROUP BY source_id',
    );
    const totals = new Map<string, number>();
    for (const r of totalsRows) {
      totals.set(String(r.source_id), Number(r.cnt ?? 0));
    }

    // Per-source name lookup. Avoid JOINing in the count queries
    // below (each `entry` query stays index-friendly).
    const nameRows = runRows(db, 'SELECT id, name FROM source');
    const nameById = new Map<string, string>();
    for (const r of nameRows) {
      nameById.set(String(r.id), String(r.name ?? ''));
    }

    const fieldExtractors: ReadonlyArray<{
      readonly index: number;
      readonly sql: string;
    }> = field.extractors.flatMap((ex, index) => {
      const sql = extractorToSqlOrNull(ex);
      return sql === null ? [] : [{ index, sql }];
    });

    let regexExtractorsSkipped = 0;
    for (const ex of field.extractors) if (ex.type === 'regex') regexExtractorsSkipped++;

    const sources: LogicalFieldCoverageSource[] = [];
    const sourceIds = [...totals.keys()].sort();
    for (const sid of sourceIds) {
      const total = totals.get(sid) ?? 0;
      const matched = fieldExtractors.length === 0
        ? 0
        : (runScalar(
            db,
            `SELECT COUNT(*) FROM entry WHERE source_id = ? AND COALESCE(${fieldExtractors.map((e) => e.sql).join(', ')}) IS NOT NULL`,
            [sid],
          ) as number | bigint | null) ?? 0;
      const extractorHits: Array<number | null> = field.extractors.map(() => null);
      for (const fe of fieldExtractors) {
        const hits = runScalar(
          db,
          `SELECT COUNT(*) FROM entry WHERE source_id = ? AND ${fe.sql} IS NOT NULL`,
          [sid],
        ) as number | bigint | null;
        extractorHits[fe.index] = Number(hits ?? 0);
      }
      sources.push({
        sourceId: sid as SourceId,
        sourceName: nameById.get(sid) ?? sid,
        matchedEntries: Number(matched),
        totalEntries: total,
        extractorHits,
      });
    }

    return { sources, regexExtractorsSkipped };
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
    // After ADR-0016 the index holds only pointers + parsed fields.
    // Estimate the on-disk pointer cost per source as
    //   (byte_end - byte_start) is the body's external size, which we
    //   don't account for here — only what's actually IN sqlite.
    // 96 bytes is a back-of-envelope per-row index cost (id+columns+
    // index entries) plus the JSON length.
    const perRows = runRows(
      db,
      `SELECT source_id,
              COUNT(*) * 96 + SUM(IFNULL(LENGTH(fields_json), 0)) AS bytes
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
    db.exec('DELETE FROM entry_minute');
    db.exec('DELETE FROM field_meta');
  },
};
