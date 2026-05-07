import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type {
  GroupBucket,
  HistogramResponse,
} from '../../../core/rpc/coordinator.contract.ts';
import type { LogEntry, LogFilter, LogLevel } from '../../../core/types/index.ts';
import type {
  FieldFilter,
} from '../../../core/types/index.ts';
import type {
  LvColumnPref,
  LvFileNode,
  LvGroupBy,
  LvSavedSearch,
  LvTab,
  LvTweaks,
} from '../../contracts/lv-types.ts';
import type { FieldDescriptor } from '../../../core/filter/field-descriptor.ts';
import { LvColumnPicker } from '../filter/LvColumnPicker.tsx';
import { LvFilterBar } from '../filter/LvFilterBar.tsx';
import { LvTimeline } from '../timeline/LvTimeline.tsx';
import { LvEmpty } from './LvEmpty.tsx';
import { LvGroupHeader } from './LvGroupHeader.tsx';
import { LvOpenMenu } from './LvOpenMenu.tsx';
import { LvRow } from './LvRow.tsx';
import { LvTabs } from './LvTabs.tsx';

const ROW_HEIGHT = 28;

/**
 * Build the inline `grid-template-columns` for table header and rows.
 * Fixed columns (LN/CARET/TS/LEVEL/SERVICE/FILE on the left, MESSAGE/
 * ACTIONS on the right) frame an arbitrary number of user-added
 * columns in the middle.
 */
const gridTemplateForColumns = (columns: ReadonlyArray<LvColumnPref>): string => {
  const left = '52px 16px 120px 58px 120px 150px';
  const right = '1fr 52px';
  if (columns.length === 0) return `${left} ${right}`;
  const userCols = columns.map((c) => `${c.widthPx}px`).join(' ');
  return `${left} ${userCols} ${right}`;
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
  /** Whether at least one source is selected; if not, render the empty state. */
  readonly hasSources: boolean;

  readonly filesById: Readonly<Record<string, LvFileNode>>;

  readonly filter: LogFilter;
  setFilter: (next: (prev: LogFilter) => LogFilter) => void;
  readonly levelCounts: Partial<Record<LogLevel, number>>;

  readonly savedSearches: ReadonlyArray<LvSavedSearch>;
  onSaveSearch: () => void;

  readonly liveTail: boolean;
  onToggleLiveTail: () => void;

  readonly tabs: ReadonlyArray<LvTab>;
  readonly activeTabId: string;
  onActivateTab: (id: string) => void;
  onCloseTab: (id: string) => void;

  readonly bookmarks: ReadonlySet<string>;
  onBookmark: (id: string) => void;
  /** Stable bookmark key for an entry (survives re-ingest). Container wires `entryFingerprint`. */
  bookmarkKeyOf: (entry: LogEntry) => string;

  readonly tweaks: LvTweaks;
  readonly timelineOn: boolean;
  onToggleTimeline: () => void;

  readonly groupBy: ReadonlyArray<LvGroupBy>;
  setGroupBy: (next: LvGroupBy[]) => void;

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
  /** Drill into a group: container appends a `fieldFilter` and clears group-by. */
  onGroupDrillDown: (bucket: GroupBucket, field: string) => void;

  /** Available fields from coordinator.getFieldSchema (built-in + dynamic). */
  readonly fieldDescriptors: ReadonlyArray<FieldDescriptor>;
  /** User-picked extra columns; the picker mutates this list. */
  readonly columns: ReadonlyArray<LvColumnPref>;
  onColumnsChange: (next: ReadonlyArray<LvColumnPref>) => void;
  /** Extracts the cell value for a `(entry, columnKey)` pair. */
  cellValueOf?: (entry: LogEntry, key: string) => unknown;

  renderDetailEditor?: RenderDetailEditor;
}

export const LvViewer = ({
  rowCount,
  totalCount,
  getRow,
  onVisibleRangeChange,
  hasSources,
  filesById,
  filter,
  setFilter,
  levelCounts,
  savedSearches,
  onSaveSearch,
  liveTail,
  onToggleLiveTail,
  tabs,
  activeTabId,
  onActivateTab,
  onCloseTab,
  bookmarks,
  onBookmark,
  bookmarkKeyOf,
  tweaks,
  timelineOn,
  onToggleTimeline,
  groupBy,
  setGroupBy,
  histogramData,
  groupBuckets,
  groupField,
  onGroupDrillDown,
  fieldDescriptors,
  columns,
  onColumnsChange,
  cellValueOf,
  renderDetailEditor,
}: LvViewerProps) => {
  const gridTemplate = useMemo(() => gridTemplateForColumns(columns), [columns]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [menu, setMenu] = useState<
    { path: string; line: number; sourceId: string; x: number; y: number } | null
  >(null);
  const streamRef = useRef<HTMLDivElement>(null);

  const [findOpen, setFindOpen] = useState(false);
  const [findQ, setFindQ] = useState('');
  const [findCase, setFindCase] = useState(false);
  const [findWord, setFindWord] = useState(false);
  const [findRegex, setFindRegex] = useState(false);
  const [findIdx, setFindIdx] = useState(0);
  const [prevFindSig, setPrevFindSig] = useState<string>('');
  const findInputRef = useRef<HTMLInputElement>(null);

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual incompat with React Compiler
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

  const toggleExpand = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const openAtLine = (
    e: React.MouseEvent<HTMLElement>,
    entry: LogEntry,
  ) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const file = filesById[entry.sourceId];
    setMenu({
      path: file?.path ?? entry.sourceId,
      line: entry.seq,
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
      let pattern = findRegex ? findQ : findQ.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
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
      const tsTxt = entry.timestamp === null ? '' : new Date(entry.timestamp).toISOString();
      const file = filesById[entry.sourceId]?.name ?? '';
      const hay = [tsTxt, entry.level, file, entry.message, entry.raw].join(' ');
      if (findRe.test(hay)) out.push(i);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally bound to virtualizer items so window updates re-run
  }, [findRe, rowCount, items.length]);

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
      <LvTabs tabs={tabs} activeId={activeTabId} onActivate={onActivateTab} onClose={onCloseTab} />

      {!hasSources ? (
        <LvEmpty />
      ) : (
        <>
          <LvFilterBar
            filters={filter}
            setFilters={setFilter}
            levelCounts={levelCounts}
            savedSearches={savedSearches}
            liveTail={liveTail}
            onToggleLiveTail={onToggleLiveTail}
            onSaveSearch={onSaveSearch}
            resultCount={rowCount}
            totalCount={totalCount}
            timelineOn={timelineOn}
            onToggleTimeline={onToggleTimeline}
            groupBy={groupBy}
            onGroupByChange={setGroupBy}
          />

          {timelineOn && (
            <LvTimeline data={histogramData} range={filter.timeRange} onRangeChange={setTimeRange} />
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
                    <circle cx="6" cy="6" r="4" fill="none" stroke="currentColor" strokeWidth="1.2" />
                    <path d="M9 9 L12 12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
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
                      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                        <text x="1" y="12" fontSize="9" fontFamily="sans-serif" fontWeight="700" fill="currentColor">A</text>
                        <text x="7" y="12" fontSize="7" fontFamily="sans-serif" fontWeight="700" fill="currentColor">a</text>
                      </svg>
                    </button>
                    <button
                      type="button"
                      className={`lv-search-tog${findWord ? ' is-on' : ''}`}
                      onClick={() => setFindWord((v) => !v)}
                      title="Match Whole Word"
                      aria-label="Match Whole Word"
                    >
                      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                        <text x="1" y="11" fontSize="8" fontFamily="sans-serif" fontWeight="700" fill="currentColor">ab</text>
                        <path d="M1 13 H15" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className={`lv-search-tog${findRegex ? ' is-on' : ''}`}
                      onClick={() => setFindRegex((v) => !v)}
                      title="Use Regular Expression"
                      aria-label="Regex"
                    >
                      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                        <path
                          d="M9 2 V8 M6.4 3.4 L11.6 6.6 M6.4 6.6 L11.6 3.4"
                          stroke="currentColor"
                          strokeWidth="1.3"
                          strokeLinecap="round"
                          fill="none"
                        />
                        <rect x="2" y="11" width="3" height="3" rx="0.5" fill="currentColor" />
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
                    <path d="M2 6 L5 3 L8 6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
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
                    <path d="M2 4 L5 7 L8 4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
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

            <div className="lv-stream-hd" style={{ gridTemplateColumns: gridTemplate }}>
              <span className="lv-sh lv-sh-ln">ln</span>
              <span className="lv-sh lv-sh-caret"></span>
              <span className="lv-sh lv-sh-ts">timestamp</span>
              <span className="lv-sh lv-sh-lvl">level</span>
              <span className="lv-sh lv-sh-svc">service</span>
              <span className="lv-sh lv-sh-file">file</span>
              {columns.map((c) => (
                <span key={c.key} className="lv-sh" title={c.key}>
                  {c.label || c.key}
                </span>
              ))}
              <span className="lv-sh lv-sh-msg">message</span>
              <span className="lv-sh lv-sh-act">
                <LvColumnPicker
                  columns={columns}
                  descriptors={fieldDescriptors}
                  onChange={onColumnsChange}
                />
              </span>
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
                      No matches for the current filter, or the field is empty in all entries.
                    </div>
                  </div>
                ) : (
                  groupBuckets.map((bucket, i) => (
                    <LvGroupHeader
                      key={`${bucket.value ?? '∅'}-${i}`}
                      bucket={bucket}
                      field={groupField}
                      onFocus={() => onGroupDrillDown(bucket, groupField)}
                      onCopy={() => {
                        if (bucket.value !== null) {
                          void navigator.clipboard?.writeText(bucket.value);
                        }
                      }}
                    />
                  ))
                )
              ) : rowCount === 0 ? (
                <div className="lv-stream-empty">
                  <div className="lv-stream-empty-title">No matching lines</div>
                  <div className="lv-stream-empty-sub">
                    Try relaxing filters, widening the time range, or clearing the query.
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
                    const fileMeta = entry ? filesById[entry.sourceId] ?? null : null;
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
                            className="lv-row lv-row-loading"
                            data-row-idx={vi.index}
                            style={{ gridTemplateColumns: gridTemplate }}
                          >
                            <span className="lv-row-gutter">
                              <span className="lv-ln">…</span>
                            </span>
                            <span className="lv-row-msg" style={{ color: 'var(--lv-muted)' }}>
                              loading row {vi.index}
                            </span>
                          </div>
                        ) : (
                          <LvRow
                            entry={entry}
                            fileMeta={fileMeta}
                            index={vi.index}
                            density={tweaks.density}
                            showDate={tweaks.showDate}
                            wrap={tweaks.wrap}
                            query={filter.query}
                            useRegex={filter.queryMode === 'regex'}
                            caseSensitive={filter.caseSensitive}
                            wholeWord={filter.wholeWord}
                            isFindMatch={findOpen && findMatchSet.has(vi.index)}
                            isFindCurrent={findOpen && findMatches[findIdx] === vi.index}
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
                            columns={columns}
                            gridTemplate={gridTemplate}
                            cellValueOf={cellValueOf}
                            renderDetailEditor={renderDetailEditor}
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
