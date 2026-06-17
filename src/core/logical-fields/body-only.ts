import type {
  FieldKey,
  LogFilter,
  LogFilterSort,
} from '../types/log-filter.ts';
import type { FieldFilter } from '../types/log-filter.ts';
import type { LogicalField, LogicalFieldsCtx } from '../types/logical-field.ts';
import { logicalFieldIdOf } from '../types/logical-field.ts';
import { isBodyOnlyLogicalField } from './sql.ts';

/**
 * Detection + filter-splitting for "body-only" logical fields — `~`-fields
 * whose extractors are all `regex` over `message`/`raw` and therefore
 * compile to SQL `NULL` (ADR-0016: the body is not in SQLite). Such fields
 * must be resolved on the coordinator's read path; these helpers let the
 * coordinator decide when to take that path and how to peel the
 * non-SQL-computable parts off a filter.
 */

/**
 * The active `LogicalField` behind `key`, but only when it is body-only.
 * Returns `null` for non-`~` keys, unknown ids, or SQL-computable fields
 * (those keep running in SQL).
 */
export const bodyOnlyFieldFor = (
  key: FieldKey,
  ctx: LogicalFieldsCtx,
): LogicalField | null => {
  const id = logicalFieldIdOf(key);
  if (id === null) return null;
  const field = ctx.activeLogicalFields?.find((f) => f.id === id);
  if (field === undefined) return null;
  return isBodyOnlyLogicalField(field) ? field : null;
};

/**
 * Does this filter reference a body-only logical field anywhere the SQL
 * path can't honour — a `fieldFilter` key or the `sortBy` key? (The
 * group-by axis is a separate `groupCounts` argument, checked by the
 * caller.) When true, the coordinator must route through the read path.
 */
export const filterTouchesBodyOnly = (
  filter: LogFilter,
  ctx: LogicalFieldsCtx,
): boolean => {
  for (const ff of filter.fieldFilters ?? []) {
    if (bodyOnlyFieldFor(ff.key, ctx) !== null) return true;
  }
  if (filter.sortBy && bodyOnlyFieldFor(filter.sortBy.key, ctx) !== null) {
    return true;
  }
  return false;
};

export interface SplitFilter {
  /**
   * The filter with every body-only constraint removed: body-only
   * `fieldFilters` dropped (so SQL returns a *superset*, not `NULL = value`
   * → empty) and a body-only `sortBy` stripped (the SQL ORDER BY would be a
   * no-op). Everything else — levels, sources, timeRange, free-text query,
   * and SQL-computable field filters — is preserved.
   */
  readonly sqlFilter: LogFilter;
  /** Body-only field filters, applied in memory after bodies are resolved. */
  readonly bodyFieldFilters: ReadonlyArray<FieldFilter>;
  /** Body-only sort, applied in memory after the full set is materialised. */
  readonly bodySort: LogFilterSort | null;
}

/**
 * Partition a filter into its SQL-computable part and the body-only
 * constraints that must run on the read path.
 */
export const splitFilterForBodyOnly = (
  filter: LogFilter,
  ctx: LogicalFieldsCtx,
): SplitFilter => {
  const bodyFieldFilters: FieldFilter[] = [];
  const sqlFieldFilters: FieldFilter[] = [];
  for (const ff of filter.fieldFilters ?? []) {
    if (bodyOnlyFieldFor(ff.key, ctx) !== null) bodyFieldFilters.push(ff);
    else sqlFieldFilters.push(ff);
  }
  const bodySort =
    filter.sortBy && bodyOnlyFieldFor(filter.sortBy.key, ctx) !== null
      ? filter.sortBy
      : null;

  const sqlFilter: LogFilter = {
    ...filter,
    fieldFilters: sqlFieldFilters,
    ...(bodySort !== null ? { sortBy: undefined } : {}),
  };
  return { sqlFilter, bodyFieldFilters, bodySort };
};
