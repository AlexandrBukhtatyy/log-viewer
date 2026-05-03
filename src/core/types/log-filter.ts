import type { LogEntry, LogLevel, SourceId } from './log-entry.ts';

export type QueryMode = 'substring' | 'fts' | 'regex';

export type FieldFilterOp = 'eq' | 'ne' | 'contains';

export interface FieldFilter {
  readonly key: string;
  readonly op: FieldFilterOp;
  readonly value: string;
}

export interface TimeRange {
  readonly from: number | null;
  readonly to: number | null;
}

export interface LogFilter {
  readonly levels: ReadonlyArray<LogLevel> | null;
  readonly query: string;
  readonly queryMode: QueryMode;
  readonly caseSensitive: boolean;
  readonly timeRange: TimeRange | null;
  readonly sources: ReadonlyArray<SourceId> | null;
  readonly fieldFilters?: ReadonlyArray<FieldFilter>;
}

export type FilterPredicate = (entry: LogEntry) => boolean;

export const EMPTY_FILTER: LogFilter = {
  levels: null,
  query: '',
  queryMode: 'substring',
  caseSensitive: false,
  timeRange: null,
  sources: null,
};
