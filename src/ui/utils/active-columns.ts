import type { LvColumnPref } from '../../hooks/use-ui-prefs.ts';
import type { LvTab } from '../contracts/lv-types.ts';

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
