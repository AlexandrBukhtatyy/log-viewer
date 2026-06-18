import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type {
  GroupBucket,
  HistogramResponse,
} from '../../../core/rpc/coordinator.contract.ts';
import type {
  LogEntry,
  LogFilter,
  LogLevel,
} from '../../../core/types/index.ts';
import type { FieldFilter } from '../../../core/types/index.ts';
import type {
  LvColumnPref,
  LvFileNode,
  LvGroupBy,
  LvSavedSearch,
  LvTab,
  LvTweaks,
} from '../../contracts/lv-types.ts';
import type { FieldDescriptor } from '../../../core/filter/field-descriptor.ts';
import type { StructuredValue } from '../../utils/search-suggest.ts';
import { builtInColumn } from '../../contracts/lv-column-registry.tsx';
import { LvFilterBar } from '../filter/LvFilterBar.tsx';
import { LvTimeline } from '../timeline/LvTimeline.tsx';
import { LvEmpty } from './LvEmpty.tsx';
import { LvGroupHeader } from './LvGroupHeader.tsx';
import { LvOpenMenu } from './LvOpenMenu.tsx';
import { LvRow } from './LvRow.tsx';
import { LvTabs } from './LvTabs.tsx';

const ROW_HEIGHT = 28;

/**
 * Build the inline `grid-template-columns`. Chrome columns (LN gutter,
 * caret on the left; MESSAGE 1fr, actions on the right) always frame
 * the data strip; every entry in `columns` becomes one data slot of
 * its declared width.
 */
const gridTemplateForColumns = (
  columns: ReadonlyArray<LvColumnPref>,
): string => {
  const parts: string[] = ['52px', '16px'];
  for (const c of columns) parts.push(`${c.widthPx}px`);
  parts.push('1fr', '52px');
  return parts.join(' ');
};

type RenderDetailEditor = (props: {
  readonly value: string;
  readonly language: string;
  readonly theme: 'lv-dark' | 'lv-light';
  readonly wordWrap: boolean;
  readonly height: number;
}) => ReactNode;

export interface LvViewerProps {
  /** Total filtered row count (post-filter, all sources). */
  readonly rowCount: number;
  /** Total unfiltered row count (pre-filter, for filter-bar counters). */
  readonly totalCount: number;
  getRow: (index: number) => LogEntry | undefined;
  onVisibleRangeChange: (from: number, to: number) => void;
  /** Mirrors `useLogWindow.isLoading` — drives the initial-load overlay. */
  readonly isLoading: boolean;
  /** Mirrors `useLogWindow.hasLoadedEntries` — gates the overlay against incremental scroll loads. */
  readonly hasLoadedEntries: boolean;
  /** Whether at least one source is selected; if not, render the empty state. */
  readonly hasSources: boolean;
  /** Whether the catalog has any source at all (drives empty-state copy). */
  readonly hasAnySource: boolean;
  /** Called when the user clicks "+ Add source" in the empty-state card. */
  onAddSource?: () => void;

  readonly filesById: Readonly<Record<string, LvFileNode>>;

  readonly filter: LogFilter;
  setFilter: (next: (prev: LogFilter) => LogFilter) => void;
  readonly levelCounts: Partial<Record<LogLevel, number>>;

  readonly savedSearches: ReadonlyArray<LvSavedSearch>;
  onSaveSearch: () => void;
  readonly recentSearches: ReadonlyArray<string>;
  onSubmitQuery: (query: string) => void;
  readonly structuredValues: ReadonlyArray<StructuredValue>;

  readonly liveTail: boolean;
  onToggleLiveTail: () => void;

  readonly tabs: ReadonlyArray<LvTab>;
  readonly activeTabId: string;
  onActivateTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  /** Promote a preview tab to pinned (dbl-click on the tab). */
  onPinTab: (id: string) => void;

  readonly bookmarks: ReadonlySet<string>;
  onBookmark: (id: string) => void;
  /** Stable bookmark key for an entry (survives re-ingest). Container wires `entryFingerprint`. */
  bookmarkKeyOf: (entry: LogEntry) => string;

  readonly tweaks: LvTweaks;
  setTweak: <K extends keyof LvTweaks>(key: K, value: LvTweaks[K]) => void;
  readonly timelineOn: boolean;
  onToggleTimeline: () => void;

  readonly groupBy: ReadonlyArray<LvGroupBy>;
  setGroupBy: (next: LvGroupBy[]) => void;

  readonly applyRulesEnabled: boolean;
  readonly tabsForApply: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
  }>;
  onApplyRulesToTabs: (target: 'all' | { ids: string[] }) => void;
  onResetTabRules: () => void;

  /** Server-aggregated histogram for timeline rendering (Phase 2). */
  readonly histogramData: HistogramResponse;
  /**
   * Server-aggregated group buckets when group-by is active. `null` means
   * group-by is off OR unsupported (e.g. UI-only `kind`); the entry stream
   * is rendered instead.
   */
  readonly groupBuckets: ReadonlyArray<GroupBucket> | null;
  /** The active group field as it would appear in SQL (`level`, `service`, …). Pure label use. */
  readonly groupField: string | null;
  /** The current root filter, copied so nested expansion can extend it
   *  with extra `fieldFilters` without mutating activeFilter. */
  readonly groupRootFilter: LogFilter;
  /** Drill into a group: container appends a `fieldFilter` and clears group-by. */
  onGroupDrillDown: (bucket: GroupBucket, field: string) => void;
  /** Fetch group buckets for a scoped filter (used by inline expand). */
  fetchGroupCounts: (
    filter: LogFilter,
    field: string,
    limit?: number,
  ) => Promise<ReadonlyArray<GroupBucket>>;
  /** Fetch entries for a scoped filter (used by inline expand of the leaf). */
  fetchEntries: (
    filter: LogFilter,
    from: number,
    to: number,
  ) => Promise<ReadonlyArray<LogEntry>>;

  /** Available fields from coordinator.getFieldSchema (built-in + dynamic). */
  readonly fieldDescriptors: ReadonlyArray<FieldDescriptor>;
  /** User-picked extra columns; the picker mutates this list. */
  readonly columns: ReadonlyArray<LvColumnPref>;
  onColumnsChange: (next: ReadonlyArray<LvColumnPref>) => void;
  /**
   * Active per-tab single-column sort. `undefined` means the worker
   * falls back to `orderByForFilter` auto-infer (physical / time).
   */
  readonly sortBy?: { readonly key: string; readonly dir: 'asc' | 'desc' };
  /**
   * Driven by header clicks; null clears the sort (back to auto-infer).
   * Click cycle: none → asc → desc → none.
   */
  onSortByChange?: (
    next: { readonly key: string; readonly dir: 'asc' | 'desc' } | null,
  ) => void;
  /** Extracts the cell value for a `(entry, columnKey)` pair. */
  cellValueOf?: (entry: LogEntry, key: string) => unknown;
  /** Resolves the parser id for an entry's source. Shown in the Meta-vкладке of `LvRowDetail`. */
  parserIdOf?: (entry: LogEntry) => string | undefined;
  /** Resolves activated `~`-namespace logical fields against an entry. */
  resolveLogicalRows?: (
    entry: LogEntry,
  ) => ReadonlyArray<readonly [string, string]>;

  renderDetailEditor?: RenderDetailEditor;
}

export const LvViewer = ({
  rowCount,
  totalCount,
  getRow,
  onVisibleRangeChange,
  isLoading,
  hasLoadedEntries,
  hasSources,
  hasAnySource,
  onAddSource,
  filesById,
  filter,
  setFilter,
  levelCounts,
  savedSearches,
  onSaveSearch,
  recentSearches,
  onSubmitQuery,
  structuredValues,
  liveTail,
  onToggleLiveTail,
  tabs,
  activeTabId,
  onActivateTab,
  onCloseTab,
  onPinTab,
  bookmarks,
  onBookmark,
  bookmarkKeyOf,
  tweaks,
  setTweak,
  timelineOn,
  onToggleTimeline,
  groupBy,
  setGroupBy,
  applyRulesEnabled,
  tabsForApply,
  onApplyRulesToTabs,
  onResetTabRules,
  histogramData,
  groupBuckets,
  groupField,
  groupRootFilter,
  onGroupDrillDown,
  fetchGroupCounts,
  fetchEntries,
  fieldDescriptors,
  columns,
  onColumnsChange,
  sortBy,
  onSortByChange,
  cellValueOf,
  parserIdOf,
  resolveLogicalRows,
  renderDetailEditor,
}: LvViewerProps) => {
  // In `raw` view the structured columns are hidden — the table is just
  // the gutter + the full log line. The picked `columns` are preserved
  // (still editable in settings) and re-appear when the user switches
  // back to the `columns` view.
  const effectiveColumns = useMemo(
    () => (tweaks.tableView === 'columns' ? columns : []),
    [tweaks.tableView, columns],
  );
  const gridTemplate = useMemo(
    () => gridTemplateForColumns(effectiveColumns),
    [effectiveColumns],
  );
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  // Inline group expansion. Each entry maps a `<field>=<value>/...`
  // path to either child buckets (next group level) or the resolved
  // log entries (when the path reaches the bottom of `groupBy`).
  type GroupNode =
    | { readonly kind: 'loading' }
    | {
        readonly kind: 'buckets';
        readonly field: string;
        readonly buckets: ReadonlyArray<GroupBucket>;
      }
    | { readonly kind: 'entries'; readonly entries: ReadonlyArray<LogEntry> }
    | { readonly kind: 'error'; readonly message: string };
  const [groupExpanded, setGroupExpanded] = useState<Map<string, GroupNode>>(
    () => new Map(),
  );

  // Reset expansion whenever the chain of group fields changes —
  // an old path is meaningless under a different grouping.
  useEffect(() => {
    setGroupExpanded(new Map());
  }, [groupBy]);
  const [menu, setMenu] = useState<{
    path: string;
    line: number;
    sourceId: string;
    x: number;
    y: number;
  } | null>(null);
  const streamRef = useRef<HTMLDivElement>(null);

  const [findOpen, setFindOpen] = useState(false);
  const [findQ, setFindQ] = useState('');
  const [findCase, setFindCase] = useState(false);
  const [findWord, setFindWord] = useState(false);
  const [findRegex, setFindRegex] = useState(false);
  const [findIdx, setFindIdx] = useState(0);
  const [prevFindSig, setPrevFindSig] = useState<string>('');
  const findInputRef = useRef<HTMLInputElement>(null);

  // Path = stack of field/value pairs that uniquely identify a node
  // in the group tree. Root buckets have `path=[bucket]`.
  type GroupPath = ReadonlyArray<{
    readonly field: string;
    readonly value: string;
  }>;
  const pathKey = (p: GroupPath): string =>
    p.map((x) => `${x.field}=${x.value}`).join('/');

  const filterForPath = (path: GroupPath): LogFilter => {
    const extra: FieldFilter[] = path.map((p) => ({
      key: p.field,
      op: '=',
      value: p.value,
    }));
    return {
      ...groupRootFilter,
      fieldFilters: [...(groupRootFilter.fieldFilters ?? []), ...extra],
    };
  };

  const toggleGroup = async (path: GroupPath): Promise<void> => {
    const key = pathKey(path);
    if (groupExpanded.has(key)) {
      setGroupExpanded((m) => {
        const next = new Map(m);
        next.delete(key);
        return next;
      });
      return;
    }
    setGroupExpanded((m) => new Map(m).set(key, { kind: 'loading' }));
    const depth = path.length;
    const nextField = groupBy[depth];
    const scoped = filterForPath(path);
    try {
      if (nextField !== undefined) {
        const buckets = await fetchGroupCounts(scoped, nextField, 200);
        setGroupExpanded((m) =>
          new Map(m).set(key, { kind: 'buckets', field: nextField, buckets }),
        );
      } else {
        const entries = await fetchEntries(scoped, 0, 500);
        setGroupExpanded((m) =>
          new Map(m).set(key, { kind: 'entries', entries }),
        );
      }
    } catch (err) {
      setGroupExpanded((m) =>
        new Map(m).set(key, {
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  };

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => streamRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 30,
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  const items = virtualizer.getVirtualItems();
  const first = items[0]?.index ?? 0;
  const last = items.length > 0 ? items[items.length - 1]!.index : 0;

  useEffect(() => {
    if (rowCount > 0) {
      onVisibleRangeChange(first, last + 1);
    }
  }, [first, last, rowCount, onVisibleRangeChange]);

  // Auto-scroll on live-tail (sticks viewer at bottom).
  useEffect(() => {
    if (liveTail && streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight;
    }
  }, [liveTail, rowCount]);

  // Switching to a different file/source in the same viewer tab swaps the
  // underlying entry set wholesale — the prior scroll position points at
  // an unrelated row and would leave the user mid-content for the wrong
  // file. Reset to the top so the new source starts at row 0.
  useEffect(() => {
    if (streamRef.current) {
      streamRef.current.scrollTop = 0;
    }
  }, [activeTabId]);

  const toggleExpand = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const openAtLine = (e: React.MouseEvent<HTMLElement>, entry: LogEntry) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const file = filesById[entry.sourceId];
    // Prefer the physical line number — that's what an external editor
    // understands. Old entries (pre-v5) have lineNumber=0 and we fall
    // back to the global ingest sequence to keep the menu usable for
    // not-yet-reingested sources.
    const line = entry.lineNumber > 0 ? entry.lineNumber : entry.seq;
    setMenu({
      path: file?.path ?? entry.sourceId,
      line,
      sourceId: entry.sourceId,
      x: Math.min(window.innerWidth - 340, rect.right - 280),
      y: rect.bottom + 6,
    });
  };

  const addFieldFilter = (ff: FieldFilter) => {
    setFilter((f) => ({ ...f, fieldFilters: [...(f.fieldFilters ?? []), ff] }));
  };

  const setTimeRange = (range: LogFilter['timeRange']) =>
    setFilter((f) => ({ ...f, timeRange: range }));

  // Find-in-table over the loaded window only — tracks visible/cached entries
  // and emits matches for them. Phase 5 will move this server-side.
  const findRe = useMemo<RegExp | null>(() => {
    if (!findQ) return null;
    try {
      let pattern = findRegex
        ? findQ
        : findQ.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
      if (findWord) pattern = `\\b(?:${pattern})\\b`;
      return new RegExp(pattern, findCase ? '' : 'i');
    } catch {
      return null;
    }
  }, [findQ, findCase, findWord, findRegex]);

  const findMatches = useMemo<number[]>(() => {
    if (!findRe) return [];
    const out: number[] = [];
    for (let i = 0; i < rowCount; i++) {
      const entry = getRow(i);
      if (!entry) continue;
      const tsTxt =
        entry.timestamp === null ? '' : new Date(entry.timestamp).toISOString();
      const file = filesById[entry.sourceId]?.name ?? '';
      // Search every cell shown in the table — fixed columns plus
      // any user-added ones — so the find-bar matches anything the
      // user can actually see.
      const customCells = cellValueOf
        ? columns.map((c) => {
            const v = cellValueOf(entry, c.key);
            if (v === null || v === undefined) return '';
            if (typeof v === 'string') return v;
            if (typeof v === 'number' || typeof v === 'boolean')
              return String(v);
            try {
              return JSON.stringify(v);
            } catch {
              return '';
            }
          })
        : [];
      const hay = [
        tsTxt,
        entry.level,
        file,
        ...customCells,
        entry.message,
        entry.raw,
      ].join(' ');
      if (findRe.test(hay)) out.push(i);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally bound to virtualizer items so window updates re-run
  }, [findRe, rowCount, items.length, columns, cellValueOf, filesById]);

  const findSig = `${findQ}|${findCase ? '1' : '0'}|${findWord ? '1' : '0'}|${findRegex ? '1' : '0'}|${rowCount}`;
  if (prevFindSig !== findSig) {
    setPrevFindSig(findSig);
    setFindIdx(0);
  }

  const findStep = (dir: 1 | -1) => {
    if (findMatches.length === 0) return;
    setFindIdx((i) => (i + dir + findMatches.length) % findMatches.length);
  };

  useEffect(() => {
    if (!findOpen || findMatches.length === 0 || !streamRef.current) return;
    const target = findMatches[findIdx]!;
    virtualizer.scrollToIndex(target, { align: 'center' });
  }, [findOpen, findIdx, findMatches, virtualizer]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && !e.shiftKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        setFindOpen(true);
        setTimeout(() => findInputRef.current?.select(), 0);
      } else if (e.key === 'Escape' && findOpen) {
        setFindOpen(false);
      } else if (meta && e.key === 'g') {
        e.preventDefault();
        if (findOpen) findStep(e.shiftKey ? -1 : 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- findStep stable per render
  }, [findOpen, findMatches.length]);

  const findMatchSet = useMemo(() => new Set(findMatches), [findMatches]);

  return (
    <div className="lv-viewer">
      <LvTabs
        tabs={tabs}
        activeId={activeTabId}
        onActivate={onActivateTab}
        onClose={onCloseTab}
        onPin={onPinTab}
      />

      {!hasSources ? (
        <LvEmpty hasAnySource={hasAnySource} onAddSource={onAddSource} />
      ) : (
        <>
          <LvFilterBar
            filters={filter}
            setFilters={setFilter}
            levelCounts={levelCounts}
            savedSearches={savedSearches}
            recentSearches={recentSearches}
            onSubmitQuery={onSubmitQuery}
            structuredValues={structuredValues}
            liveTail={liveTail}
            onToggleLiveTail={onToggleLiveTail}
            onSaveSearch={onSaveSearch}
            resultCount={rowCount}
            totalCount={totalCount}
            timelineOn={timelineOn}
            onToggleTimeline={onToggleTimeline}
            groupBy={groupBy}
            onGroupByChange={setGroupBy}
            applyRulesEnabled={applyRulesEnabled}
            tabsForApply={tabsForApply}
            onApplyRulesToTabs={onApplyRulesToTabs}
            onResetTabRules={onResetTabRules}
            fieldDescriptors={fieldDescriptors}
            tweaks={tweaks}
            setTweak={setTweak}
            columns={columns}
            onColumnsChange={onColumnsChange}
            filesById={filesById}
          />

          {timelineOn && (
            <LvTimeline
              data={histogramData}
              range={filter.timeRange}
              onRangeChange={setTimeRange}
            />
          )}

          <div className="lv-stream-wrap">
            {findOpen && (
              <div
                className="lv-findbar"
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setFindOpen(false);
                  else if (e.key === 'Enter') {
                    e.preventDefault();
                    findStep(e.shiftKey ? -1 : 1);
                  }
                }}
              >
                <div className="lv-search lv-find-search">
                  <svg
                    className="lv-search-ico"
                    viewBox="0 0 14 14"
                    width="12"
                    height="12"
                    aria-hidden="true"
                  >
                    <circle
                      cx="6"
                      cy="6"
                      r="4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.2"
                    />
                    <path
                      d="M9 9 L12 12"
                      stroke="currentColor"
                      strokeWidth="1.2"
                      strokeLinecap="round"
                    />
                  </svg>
                  <input
                    ref={findInputRef}
                    type="text"
                    className="lv-search-input"
                    value={findQ}
                    onChange={(e) => setFindQ(e.target.value)}
                    placeholder="Find in loaded window…"
                    spellCheck={false}
                    autoFocus
                  />
                  <div className="lv-search-toggles">
                    <button
                      type="button"
                      className={`lv-search-tog${findCase ? ' is-on' : ''}`}
                      onClick={() => setFindCase((v) => !v)}
                      title="Match Case"
                      aria-label="Match Case"
                    >
                      <svg
                        viewBox="0 0 16 16"
                        width="12"
                        height="12"
                        aria-hidden="true"
                      >
                        <text
                          x="1"
                          y="12"
                          fontSize="9"
                          fontFamily="sans-serif"
                          fontWeight="700"
                          fill="currentColor"
                        >
                          A
                        </text>
                        <text
                          x="7"
                          y="12"
                          fontSize="7"
                          fontFamily="sans-serif"
                          fontWeight="700"
                          fill="currentColor"
                        >
                          a
                        </text>
                      </svg>
                    </button>
                    <button
                      type="button"
                      className={`lv-search-tog${findWord ? ' is-on' : ''}`}
                      onClick={() => setFindWord((v) => !v)}
                      title="Match Whole Word"
                      aria-label="Match Whole Word"
                    >
                      <svg
                        viewBox="0 0 16 16"
                        width="12"
                        height="12"
                        aria-hidden="true"
                      >
                        <text
                          x="1"
                          y="11"
                          fontSize="8"
                          fontFamily="sans-serif"
                          fontWeight="700"
                          fill="currentColor"
                        >
                          ab
                        </text>
                        <path
                          d="M1 13 H15"
                          stroke="currentColor"
                          strokeWidth="1.4"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className={`lv-search-tog${findRegex ? ' is-on' : ''}`}
                      onClick={() => setFindRegex((v) => !v)}
                      title="Use Regular Expression"
                      aria-label="Regex"
                    >
                      <svg
                        viewBox="0 0 16 16"
                        width="12"
                        height="12"
                        aria-hidden="true"
                      >
                        <path
                          d="M9 2 V8 M6.4 3.4 L11.6 6.6 M6.4 6.6 L11.6 3.4"
                          stroke="currentColor"
                          strokeWidth="1.3"
                          strokeLinecap="round"
                          fill="none"
                        />
                        <rect
                          x="2"
                          y="11"
                          width="3"
                          height="3"
                          rx="0.5"
                          fill="currentColor"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
                <span className="lv-find-count">
                  {findQ
                    ? findMatches.length === 0
                      ? 'No results'
                      : `${findIdx + 1} of ${findMatches.length}`
                    : ''}
                </span>
                <button
                  type="button"
                  className="lv-find-nav"
                  onClick={() => findStep(-1)}
                  title="Previous (Shift+Enter)"
                  aria-label="Previous"
                >
                  <svg viewBox="0 0 10 10" width="10" height="10">
                    <path
                      d="M2 6 L5 3 L8 6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                <button
                  type="button"
                  className="lv-find-nav"
                  onClick={() => findStep(1)}
                  title="Next (Enter)"
                  aria-label="Next"
                >
                  <svg viewBox="0 0 10 10" width="10" height="10">
                    <path
                      d="M2 4 L5 7 L8 4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                <button
                  type="button"
                  className="lv-find-close"
                  onClick={() => setFindOpen(false)}
                  title="Close (Esc)"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
            )}

            <div
              className="lv-stream-hd"
              style={{ gridTemplateColumns: gridTemplate }}
            >
              <span
                className="lv-sh lv-sh-ln"
                title={
                  tweaks.gutterMode === 'entry'
                    ? 'Per-file entry ordinal'
                    : tweaks.gutterMode === 'both'
                      ? 'Line · entry'
                      : 'Physical line number in the source file'
                }
              >
                {tweaks.gutterMode === 'entry'
                  ? 'entry'
                  : tweaks.gutterMode === 'both'
                    ? 'line·entry'
                    : 'line'}
              </span>
              <span className="lv-sh lv-sh-caret"></span>
              {effectiveColumns.map((c) => {
                const d = builtInColumn(c.key);
                const label = d?.label ?? c.label ?? c.key;
                const extra = d?.headerClass ? ` ${d.headerClass}` : '';
                const active = sortBy?.key === c.key;
                const indicator = active
                  ? sortBy?.dir === 'desc'
                    ? '↓'
                    : '↑'
                  : null;
                const cycle = (): void => {
                  if (onSortByChange === undefined) return;
                  if (!active) onSortByChange({ key: c.key, dir: 'asc' });
                  else if (sortBy?.dir === 'asc')
                    onSortByChange({ key: c.key, dir: 'desc' });
                  else onSortByChange(null);
                };
                const titleSuffix = active
                  ? sortBy?.dir === 'desc'
                    ? ' — click to clear sort'
                    : ' — click to sort descending'
                  : ' — click to sort ascending';
                return (
                  <button
                    type="button"
                    key={c.key}
                    className={
                      `lv-sh${extra}` +
                      (active ? ` is-sorted is-sort-${sortBy?.dir}` : '')
                    }
                    title={label + titleSuffix}
                    onClick={cycle}
                  >
                    {label}
                    {indicator !== null && (
                      <span className="lv-sh-sort" aria-hidden="true">
                        {' '}
                        {indicator}
                      </span>
                    )}
                  </button>
                );
              })}
              <span className="lv-sh lv-sh-msg">
                {tweaks.tableView === 'columns' && effectiveColumns.length > 0
                  ? 'message'
                  : 'log line'}
              </span>
              <span className="lv-sh lv-sh-act" />
            </div>

            <div
              className="lv-stream"
              ref={streamRef}
              data-density={tweaks.density}
              style={{ flex: 1, overflowY: 'auto', position: 'relative' }}
            >
              {groupBuckets !== null && groupField !== null ? (
                groupBuckets.length === 0 ? (
                  <div className="lv-stream-empty">
                    <div className="lv-stream-empty-title">No groups</div>
                    <div className="lv-stream-empty-sub">
                      No matches for the current filter, or the field is empty
                      in all entries.
                    </div>
                  </div>
                ) : (
                  (() => {
                    const renderBucket = (
                      bucket: GroupBucket,
                      field: string,
                      path: GroupPath,
                      depth: number,
                      keySuffix: string,
                    ): ReactNode => {
                      const key = pathKey(path);
                      const node = groupExpanded.get(key);
                      const isExpanded = node !== undefined;
                      return (
                        <Fragment key={`${key}|${keySuffix}`}>
                          <LvGroupHeader
                            bucket={bucket}
                            field={field}
                            depth={depth}
                            expanded={isExpanded}
                            onToggle={() => {
                              if (bucket.value === null) return;
                              void toggleGroup(path);
                            }}
                            onFocus={() => onGroupDrillDown(bucket, field)}
                            onCopy={() => {
                              if (bucket.value !== null) {
                                void navigator.clipboard?.writeText(
                                  bucket.value,
                                );
                              }
                            }}
                          />
                          {node?.kind === 'loading' && (
                            <div
                              className="lv-stream-empty"
                              style={{ paddingLeft: 12 + (depth + 1) * 16 }}
                            >
                              Loading…
                            </div>
                          )}
                          {node?.kind === 'error' && (
                            <div
                              className="lv-stream-empty"
                              style={{ paddingLeft: 12 + (depth + 1) * 16 }}
                            >
                              {node.message}
                            </div>
                          )}
                          {node?.kind === 'buckets' &&
                            node.buckets.map((sub, i) =>
                              renderBucket(
                                sub,
                                node.field,
                                [
                                  ...path,
                                  { field: node.field, value: sub.value ?? '' },
                                ],
                                depth + 1,
                                String(i),
                              ),
                            )}
                          {node?.kind === 'entries' &&
                            node.entries.map((entry, i) => (
                              <LvRow
                                key={`${entry.id}-${i}`}
                                entry={entry}
                                fileMeta={filesById[entry.sourceId] ?? null}
                                index={-1}
                                density={tweaks.density}
                                showDate={tweaks.showDate}
                                highlight={null}
                                selected={false}
                                expanded={expanded.has(entry.id)}
                                bookmarked={bookmarks.has(bookmarkKeyOf(entry))}
                                onSelect={() => {}}
                                onToggleExpand={() => toggleExpand(entry.id)}
                                onBookmark={() =>
                                  onBookmark(bookmarkKeyOf(entry))
                                }
                                onOpenAtLine={openAtLine}
                                onContextMenu={openAtLine}
                                onAddFieldFilter={addFieldFilter}
                                theme={tweaks.theme}
                                columns={effectiveColumns}
                                gridTemplate={gridTemplate}
                                cellValueOf={cellValueOf}
                                parserIdOf={parserIdOf}
                                resolveLogicalRows={resolveLogicalRows}
                                indentPx={12 + (depth + 1) * 16}
                                renderDetailEditor={renderDetailEditor}
                                gutterMode={tweaks.gutterMode}
                                tableView={tweaks.tableView}
                              />
                            ))}
                        </Fragment>
                      );
                    };
                    return groupBuckets.map((bucket, i) =>
                      renderBucket(
                        bucket,
                        groupField,
                        [{ field: groupField, value: bucket.value ?? '' }],
                        0,
                        String(i),
                      ),
                    );
                  })()
                )
              ) : rowCount === 0 ? (
                <div className="lv-stream-empty">
                  <div className="lv-stream-empty-title">No matching lines</div>
                  <div className="lv-stream-empty-sub">
                    Try relaxing filters, widening the time range, or clearing
                    the query.
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    height: virtualizer.getTotalSize(),
                    width: '100%',
                    position: 'relative',
                  }}
                >
                  {items.map((vi) => {
                    const entry = getRow(vi.index);
                    const fileMeta = entry
                      ? (filesById[entry.sourceId] ?? null)
                      : null;
                    return (
                      <div
                        key={vi.key}
                        ref={virtualizer.measureElement}
                        data-index={vi.index}
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          right: 0,
                          transform: `translateY(${vi.start}px)`,
                        }}
                      >
                        {entry === undefined ? (
                          <div
                            className="lv-row lv-row-skeleton"
                            data-row-idx={vi.index}
                            style={{ gridTemplateColumns: gridTemplate }}
                            aria-busy="true"
                          >
                            <span className="lv-row-gutter">
                              <span className="lv-skel lv-skel-num" />
                            </span>
                            <span className="lv-row-caret" />
                            {effectiveColumns.map((c) => (
                              <span
                                key={c.key}
                                className="lv-skel lv-skel-cell"
                              />
                            ))}
                            <span className="lv-skel lv-skel-cell lv-skel-msg" />
                            <span />
                          </div>
                        ) : (
                          <LvRow
                            entry={entry}
                            fileMeta={fileMeta}
                            index={vi.index}
                            density={tweaks.density}
                            showDate={tweaks.showDate}
                            highlight={
                              findOpen && findQ.length > 0
                                ? {
                                    query: findQ,
                                    useRegex: findRegex,
                                    caseSensitive: findCase,
                                    wholeWord: findWord,
                                  }
                                : null
                            }
                            isFindMatch={findOpen && findMatchSet.has(vi.index)}
                            isFindCurrent={
                              findOpen && findMatches[findIdx] === vi.index
                            }
                            selected={false}
                            expanded={expanded.has(entry.id)}
                            bookmarked={bookmarks.has(bookmarkKeyOf(entry))}
                            onSelect={() => {}}
                            onToggleExpand={() => toggleExpand(entry.id)}
                            onBookmark={() => onBookmark(bookmarkKeyOf(entry))}
                            onOpenAtLine={openAtLine}
                            onContextMenu={openAtLine}
                            onAddFieldFilter={addFieldFilter}
                            theme={tweaks.theme}
                            columns={effectiveColumns}
                            gridTemplate={gridTemplate}
                            cellValueOf={cellValueOf}
                            parserIdOf={parserIdOf}
                            resolveLogicalRows={resolveLogicalRows}
                            renderDetailEditor={renderDetailEditor}
                            gutterMode={tweaks.gutterMode}
                            tableView={tweaks.tableView}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {liveTail && (
                <div className="lv-live-pulse">
                  <span className="lv-live-dot is-on" />
                  <span>Tailing — new lines appear below</span>
                </div>
              )}
              {isLoading && !hasLoadedEntries && rowCount > 0 && (
                <div
                  className="lv-stream-loading-overlay"
                  role="status"
                  aria-live="polite"
                >
                  <span className="lv-spinner" aria-hidden="true" />
                  <span>Loading entries…</span>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {menu && (
        <LvOpenMenu
          path={menu.path}
          line={menu.line}
          anchor={{ x: menu.x, y: menu.y }}
          onOpenInApp={() => setMenu(null)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
};
