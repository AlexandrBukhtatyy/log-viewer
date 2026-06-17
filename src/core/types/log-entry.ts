export type LogLevel =
  | 'trace'
  | 'debug'
  | 'info'
  | 'warn'
  | 'error'
  | 'fatal'
  | 'unknown';

/**
 * Canonical level ordering shared by the level filter, the group-by /
 * histogram level breakdown, and the read-path in-memory aggregator.
 * Single source of truth so the SQL path (`aggregate.ts`) and the
 * in-memory path (`logical-fields/read-path.ts`) never diverge.
 */
export const ALL_LEVELS: ReadonlyArray<LogLevel> = [
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
  'unknown',
];

export type EntryId = string & { readonly __brand: 'EntryId' };
export type SourceId = string & { readonly __brand: 'SourceId' };

export interface LogEntry {
  readonly id: EntryId;
  readonly sourceId: SourceId;
  readonly seq: number;
  readonly timestamp: number | null;
  readonly level: LogLevel;
  /** Reconstructed by the read-path on demand from the underlying byte range. */
  readonly message: string;
  /** Reconstructed by the read-path on demand from the underlying byte range. */
  readonly raw: string;
  /**
   * Structured data extracted **from the log line itself** — for JSON
   * logs this is the full object as it appeared on the wire
   * (including well-known `time`/`level`/`msg` keys that are also
   * lifted onto `timestamp`/`level`/`message` for indexing); for
   * regex-based parsers it's the named groups (`status`,
   * `remote_addr`, …); for plain-text lines it's positional
   * `$0/$1/…` tokens. Never carries application-side metadata:
   * source ids, file paths, parser names and other `@`-namespace
   * attributes live on `LogEntry` itself and are surfaced through
   * the Meta tab (see ADR-0028).
   */
  readonly fields: Readonly<Record<string, unknown>>;
  /**
   * Pre-serialized `JSON.stringify(fields)` produced by the parser-worker so
   * the indexer doesn't have to re-stringify on the hot serial insert path.
   * Optional: only the ingest-path populates it; entries reconstructed in
   * the read-path (rowToEntry) and entries built in tests/fixtures omit it
   * — `insertBatch` falls back to `JSON.stringify(fields)` when missing.
   */
  readonly fieldsJson?: string;
  /**
   * Pointer back to the source's byte storage so the read-path can resolve
   * `raw`/`message` lazily without keeping the body in SQLite (ADR-0016).
   * `filePath` semantics:
   *   - directory: relative path inside the source-handle (`sub/a.log`)
   *   - file:      `''`
   *   - opfs-single (text/pasted/snapshot/url): `''`
   *   - opfs-chunked (stream): chunk-seq stringified (`'0'`, `'1'`, …)
   */
  readonly filePath: string;
  readonly byteStart: number;
  /** Exclusive; does NOT include trailing `\r\n` / `\n`. */
  readonly byteEnd: number;
  /**
   * 1-based physical line number of the entry's first line inside its
   * source file. For multi-line records (stack-trace folded by the
   * continuation regex) this is the line of the block's first physical
   * line, not the lines of the continuations.
   * `0` for entries persisted before the v5 migration — older rows
   * never recorded line numbers and re-deriving from `byteStart` is not
   * generally possible (would require re-scanning the file).
   */
  readonly lineNumber: number;
  /**
   * 1-based ordinal of this entry inside its source file — counts
   * logical records, not physical lines. Equals `lineNumber` for
   * single-line records when the parser doesn't skip anything; lower
   * than `lineNumber` when continuation lines fold into the previous
   * record. `0` for pre-v5 rows.
   */
  readonly fileSeq: number;
}

/**
 * Parser output before the orchestrator stamps in the byte pointer. Parsers
 * see only the line text — they don't know where the line lives in the
 * underlying storage. The orchestrator (or parser-worker shim) tags every
 * record with its `filePath`/`byteStart`/`byteEnd`/`lineNumber`/`fileSeq`
 * after the parser returns.
 */
export type ParsedRecord = Omit<
  LogEntry,
  'filePath' | 'byteStart' | 'byteEnd' | 'lineNumber' | 'fileSeq'
>;
