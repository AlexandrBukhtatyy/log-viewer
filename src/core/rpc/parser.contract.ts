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

export interface ParserApi {
  ping: () => Promise<string>;
  detectParser: (sample: ReadonlyArray<string>) => Promise<string>;
  parse: (
    lines: ReadonlyArray<string>,
    ctx: ParseRequestCtx,
  ) => Promise<ReadonlyArray<LogEntry>>;
}
