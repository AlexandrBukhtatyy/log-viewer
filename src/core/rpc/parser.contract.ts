import type { LogEntry, SourceId } from '../types/index.ts';

export interface ParseRequestCtx {
  readonly sourceId: SourceId;
  readonly startSeq: number;
  readonly parserId?: string;
  /**
   * For sources with inner file structure (currently only `directory` and
   * `snapshot`), the forward-slash relative path inside the source root.
   * Parsers copy this into `entry.fields.file_path`, where the sidebar
   * uses it to filter logs down to a single file via `JSON_EXTRACT`.
   * Sources without sub-structure leave it `undefined`.
   */
  readonly filePath?: string;
}

/**
 * Input frame for `parse()`. Carries the line text plus the byte range it
 * occupies in the underlying storage (FS file or OPFS spool). The parser
 * only sees `line`; the parser-worker shim stamps `byteStart`/`byteEnd`
 * onto the resulting LogEntry as the offset-pointer used at read time.
 */
export interface ParseLineFrame {
  readonly line: string;
  readonly byteStart: number;
  readonly byteEnd: number;
}

export interface ParserApi {
  ping: () => Promise<string>;
  detectParser: (sample: ReadonlyArray<string>) => Promise<string>;
  parse: (
    lines: ReadonlyArray<ParseLineFrame>,
    ctx: ParseRequestCtx,
  ) => Promise<ReadonlyArray<LogEntry>>;
}
