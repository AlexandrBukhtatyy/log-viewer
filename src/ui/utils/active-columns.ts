import type { LogFilter } from '../../core/types/index.ts';
import type { LvColumnPref } from '../../hooks/use-ui-prefs.ts';
import type { LvGroupBy, LvTab } from '../contracts/lv-types.ts';

/**
 * Pick the column profile that should drive the log viewer for the
 * currently active tab.
 *
 *  - For the `'__all__'` aggregate tab → the global `tweaks.columns`
 *    (legacy single-source-of-truth for cross-source views).
 *  - For per-file tabs → `tab.columns` when set, otherwise fall back
 *    to the global columns. `tab.columns` is seeded at open time from
 *    the parser's `defaultColumns` (see Phase 1.5 in
 *    docs/plans/columns-multi-format-impl.md) and overridden by user
 *    edits via the column picker.
 *
 * Pure function — extracted out of `LvAppContainer` so it can be
 * tested without a DOM (vitest runs in node).
 */
export const resolveActiveColumns = (
  activeTabId: string,
  openTabs: ReadonlyArray<LvTab>,
  globalColumns: ReadonlyArray<LvColumnPref>,
): ReadonlyArray<LvColumnPref> => {
  if (activeTabId === '__all__') return globalColumns;
  const tab = openTabs.find((t) => t.id === activeTabId);
  return tab?.columns ?? globalColumns;
};

/**
 * Per-tab group-by, same `tab override ?? global default` shape as
 * {@link resolveActiveColumns}. The `'__all__'` aggregate tab always reads
 * the global value. An explicitly-empty `tab.groupBy` (user turned grouping
 * off on this tab) is honoured and does NOT fall back to the global set.
 */
export const resolveActiveGroupBy = (
  activeTabId: string,
  openTabs: ReadonlyArray<LvTab>,
  globalGroupBy: ReadonlyArray<LvGroupBy>,
): ReadonlyArray<LvGroupBy> => {
  if (activeTabId === '__all__') return globalGroupBy;
  return openTabs.find((t) => t.id === activeTabId)?.groupBy ?? globalGroupBy;
};

/**
 * Per-tab core filter (query / levels / services / fieldFilters / timeRange),
 * same resolve shape as above. Pure — it does NOT know about selection; the
 * container mixes the tab's `sources`/`filePaths` scope on top of the result.
 */
export const resolveActiveCoreFilter = (
  activeTabId: string,
  openTabs: ReadonlyArray<LvTab>,
  globalCoreFilter: LogFilter,
): LogFilter => {
  if (activeTabId === '__all__') return globalCoreFilter;
  return openTabs.find((t) => t.id === activeTabId)?.filter ?? globalCoreFilter;
};

/**
 * The bundle of view rules copied by the "apply to other tabs" action:
 * filter + group-by + single-column sort. Columns are deliberately excluded —
 * they are format-specific (pino ≠ nginx) and seeded per parser.
 */
export interface LvTabRules {
  readonly filter: LogFilter;
  readonly groupBy: ReadonlyArray<LvGroupBy>;
  readonly sortBy: LvTab['sortBy'];
}

/**
 * Read the effective view rules of a source tab — what its filter bar shows.
 * For `'__all__'` (or an unknown id) the global defaults are returned; for a
 * file tab, per-tab overrides win, falling back to the globals where absent.
 */
export const extractTabRules = (
  sourceTabId: string,
  openTabs: ReadonlyArray<LvTab>,
  globalCoreFilter: LogFilter,
  globalGroupBy: ReadonlyArray<LvGroupBy>,
): LvTabRules => {
  const tab =
    sourceTabId === '__all__'
      ? undefined
      : openTabs.find((t) => t.id === sourceTabId);
  return {
    filter: stripScope(tab?.filter ?? globalCoreFilter),
    groupBy: tab?.groupBy ?? globalGroupBy,
    sortBy: tab?.sortBy,
  };
};

/**
 * Write `rules` onto every tab in `targetIds`, leaving all other tabs (and the
 * `'__all__'` aggregate) untouched. Returns a new array only mutating matched
 * tabs. The filter is stored without scope (`sources`/`filePaths`) — that is
 * always derived from the target tab's own id, never copied across tabs.
 */
export const applyTabRules = (
  openTabs: ReadonlyArray<LvTab>,
  targetIds: ReadonlySet<string>,
  rules: LvTabRules,
): LvTab[] =>
  openTabs.map((t) =>
    t.id !== '__all__' && targetIds.has(t.id)
      ? {
          ...t,
          filter: stripScope(rules.filter),
          groupBy: rules.groupBy,
          sortBy: rules.sortBy,
        }
      : t,
  );

/** Null out the selection-derived fields so a per-tab filter never freezes
 *  another tab's source/file scope. */
const stripScope = (f: LogFilter): LogFilter => ({
  ...f,
  sources: null,
  filePaths: null,
});
