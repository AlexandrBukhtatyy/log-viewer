import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  LvFieldFilter,
  LvFileNode,
  LvFilters,
  LvGroup,
  LvGroupBy,
  LvLogEntry,
  LvLogLevel,
  LvSavedSearch,
  LvTab,
  LvTweaks,
} from '../../contracts/lv-types.ts';
import { lvApplyFilters, lvBuildGroups, lvGroupId } from '../../utils/lv-filter.ts';
import { LvFilterBar } from '../filter/LvFilterBar.tsx';
import { LvTimeline } from '../timeline/LvTimeline.tsx';
import { LvEmpty } from './LvEmpty.tsx';
import { LvFilePeek } from './LvFilePeek.tsx';
import { LvGroupHeader } from './LvGroupHeader.tsx';
import { LvOpenMenu } from './LvOpenMenu.tsx';
import { LvRow } from './LvRow.tsx';
import { LvTabs } from './LvTabs.tsx';

type RenderDetailEditor = (props: {
  readonly value: string;
  readonly language: string;
  readonly theme: 'lv-dark' | 'lv-light';
  readonly wordWrap: boolean;
  readonly height: number;
}) => ReactNode;

interface RowProps {
  readonly density: LvTweaks['density'];
  readonly showDate: boolean;
  readonly wrap: boolean;
  readonly query: string;
  readonly useRegex: boolean;
  readonly caseSensitive: boolean;
  readonly wholeWord: boolean;
  readonly expanded: ReadonlySet<string>;
  readonly bookmarks: ReadonlySet<string>;
  readonly toggleExpand: (id: string) => void;
  readonly onBookmark: (id: string) => void;
  readonly openAtLine: (e: React.MouseEvent<HTMLElement>, entry: LvLogEntry) => void;
  readonly addFieldFilter: (ff: LvFieldFilter) => void;
  readonly theme: LvTweaks['theme'];
  readonly renderDetailEditor?: RenderDetailEditor;
}

interface GroupCtx {
  readonly expandedGroups: ReadonlySet<string>;
  readonly toggleGroup: (id: string) => void;
  readonly onFocus: (g: LvGroup) => void;
  readonly onCopy: (g: LvGroup) => void;
  readonly rowProps: RowProps;
}

const renderGroupTree = (groups: ReadonlyArray<LvGroup>, ctx: GroupCtx): ReactNode[] => {
  const out: ReactNode[] = [];
  for (const g of groups) {
    const id = lvGroupId(g);
    const isOpen = ctx.expandedGroups.has(id);
    out.push(
      <LvGroupHeader
        key={`g:${id}`}
        group={g}
        expanded={isOpen}
        onToggle={() => ctx.toggleGroup(id)}
        onFocus={() => ctx.onFocus(g)}
        onCopy={() => ctx.onCopy(g)}
      />,
    );
    if (isOpen) {
      if (g.children) {
        out.push(...renderGroupTree(g.children, ctx));
      } else {
        const indent = (g.depth + 1) * 16;
        const p = ctx.rowProps;
        for (let i = 0; i < g.entries.length; i++) {
          const e = g.entries[i]!;
          out.push(
            <LvRow
              key={e.id}
              entry={e}
              index={i}
              density={p.density}
              showDate={p.showDate}
              wrap={p.wrap}
              query={p.query}
              useRegex={p.useRegex}
              caseSensitive={p.caseSensitive}
              wholeWord={p.wholeWord}
              selected={false}
              expanded={p.expanded.has(e.id)}
              bookmarked={p.bookmarks.has(e.id)}
              onSelect={() => {}}
              onToggleExpand={() => p.toggleExpand(e.id)}
              onBookmark={() => p.onBookmark(e.id)}
              onOpenAtLine={p.openAtLine}
              onContextMenu={p.openAtLine}
              onAddFieldFilter={p.addFieldFilter}
              theme={p.theme}
              indentPx={indent}
              renderDetailEditor={p.renderDetailEditor}
            />,
          );
        }
      }
    }
  }
  return out;
};

export interface LvViewerProps {
  readonly selectedFileIds: ReadonlySet<string>;
  readonly logsByFile: Readonly<Record<string, ReadonlyArray<LvLogEntry>>>;
  readonly filesById: Readonly<Record<string, LvFileNode>>;
  readonly filters: LvFilters;
  setFilters: (next: (prev: LvFilters) => LvFilters) => void;
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
  readonly tweaks: LvTweaks;
  readonly timelineOn: boolean;
  onToggleTimeline: () => void;
  readonly groupBy: ReadonlyArray<LvGroupBy>;
  setGroupBy: (next: LvGroupBy[]) => void;
  renderDetailEditor?: RenderDetailEditor;
}

export const LvViewer = ({
  selectedFileIds,
  logsByFile,
  filesById,
  filters,
  setFilters,
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
  tweaks,
  timelineOn,
  onToggleTimeline,
  groupBy,
  setGroupBy,
  renderDetailEditor,
}: LvViewerProps) => {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const [prevGroupSig, setPrevGroupSig] = useState<string>('');
  const [prevFindSig, setPrevFindSig] = useState<string>('');
  const [peek, setPeek] = useState<{ fileId: string; line: number } | null>(null);
  const [menu, setMenu] = useState<{ entry: LvLogEntry; x: number; y: number } | null>(null);
  const [liveBump, setLiveBump] = useState(0);
  const streamRef = useRef<HTMLDivElement>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findQ, setFindQ] = useState('');
  const [findCase, setFindCase] = useState(false);
  const [findWord, setFindWord] = useState(false);
  const [findRegex, setFindRegex] = useState(false);
  const [findIdx, setFindIdx] = useState(0);
  const findInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!liveTail) return;
    const iv = setInterval(() => setLiveBump((n) => n + 1), 1200);
    return () => clearInterval(iv);
  }, [liveTail]);

  const activeFileIds = useMemo(() => {
    if (activeTabId === '__all__') return Array.from(selectedFileIds);
    return [activeTabId];
  }, [activeTabId, selectedFileIds]);

  const combined = useMemo(() => {
    let all: LvLogEntry[] = [];
    for (const id of activeFileIds) {
      const arr = logsByFile[id] ?? [];
      all = all.concat(arr);
    }
    all.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
    void liveBump;
    return all;
  }, [activeFileIds, logsByFile, liveBump]);

  const levelCounts = useMemo<Partial<Record<LvLogLevel, number>>>(() => {
    const c: Partial<Record<LvLogLevel, number>> = { error: 0, warn: 0, info: 0, debug: 0, trace: 0 };
    for (const e of combined) c[e.level] = (c[e.level] ?? 0) + 1;
    return c;
  }, [combined]);

  const filtered = useMemo(() => lvApplyFilters(combined, filters), [combined, filters]);

  const groups = useMemo<LvGroup[] | null>(() => {
    if (!Array.isArray(groupBy) || groupBy.length === 0) return null;
    return lvBuildGroups(filtered, groupBy);
  }, [filtered, groupBy]);

  const groupByKey = Array.isArray(groupBy) ? groupBy.join('|') : '';

  // Reset auto-expanded groups whenever the grouping key changes — derived state.
  const groupSig = `${groupByKey}|${groups?.length ?? 0}`;
  if (prevGroupSig !== groupSig) {
    setPrevGroupSig(groupSig);
    setExpandedGroups(
      groups && groups.length <= 3 ? new Set(groups.map((g) => lvGroupId(g))) : new Set(),
    );
  }

  useEffect(() => {
    if (liveTail && streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight;
    }
  }, [filtered.length, liveTail]);

  const toggleExpand = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const openAtLine = (e: React.MouseEvent<HTMLElement>, entry: LvLogEntry) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setMenu({
      entry,
      x: Math.min(window.innerWidth - 340, rect.right - 280),
      y: rect.bottom + 6,
    });
  };

  const openInAppPeek = (entry: LvLogEntry) => {
    setPeek({ fileId: entry.fileId, line: entry.line });
  };

  const addFieldFilter = (ff: LvFieldFilter) => {
    setFilters((f) => ({ ...f, fieldFilters: [...f.fieldFilters, ff] }));
  };

  const setTimeRange = (r: [number, number] | null) =>
    setFilters((f) => ({ ...f, timeRange: r }));

  const findRe = useMemo<RegExp | null>(() => {
    if (!findQ) return null;
    try {
      let pattern = findRegex ? findQ : findQ.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
      if (findWord) pattern = `\\b(?:${pattern})\\b`;
      return new RegExp(pattern, findCase ? 'g' : 'gi');
    } catch {
      return null;
    }
  }, [findQ, findCase, findWord, findRegex]);

  // Stateless test() requires a non-global regex — RegExp.test on /g advances lastIndex.
  const findReTest = useMemo<RegExp | null>(() => {
    if (!findRe) return null;
    return new RegExp(findRe.source, findRe.flags.replace('g', ''));
  }, [findRe]);

  const findMatches = useMemo<number[]>(() => {
    if (!findReTest) return [];
    const out: number[] = [];
    for (let i = 0; i < filtered.length; i++) {
      const e = filtered[i]!;
      const hay = [e.ts, e.level, e.service, e.file, e.msg, e.raw].join(' ');
      if (findReTest.test(hay)) out.push(i);
    }
    return out;
  }, [findReTest, filtered]);

  // Reset find cursor when query options or result-set length changes — derived state.
  const findSig = `${findQ}|${findCase ? '1' : '0'}|${findWord ? '1' : '0'}|${findRegex ? '1' : '0'}|${filtered.length}`;
  if (prevFindSig !== findSig) {
    setPrevFindSig(findSig);
    setFindIdx(0);
  }

  useEffect(() => {
    if (!findOpen || findMatches.length === 0 || !streamRef.current) return;
    const target = findMatches[findIdx];
    const el = streamRef.current.querySelector(`[data-row-idx="${target}"]`);
    if (el instanceof HTMLElement) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [findOpen, findIdx, findMatches]);

  const findStep = (dir: 1 | -1) => {
    if (findMatches.length === 0) return;
    setFindIdx((i) => (i + dir + findMatches.length) % findMatches.length);
  };

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

  const empty = selectedFileIds.size === 0;

  return (
    <div className="lv-viewer">
      <LvTabs tabs={tabs} activeId={activeTabId} onActivate={onActivateTab} onClose={onCloseTab} />

      {empty ? (
        <LvEmpty />
      ) : (
        <>
          <LvFilterBar
            filters={filters}
            setFilters={setFilters}
            levelCounts={levelCounts}
            savedSearches={savedSearches}
            liveTail={liveTail}
            onToggleLiveTail={onToggleLiveTail}
            onSaveSearch={onSaveSearch}
            resultCount={filtered.length}
            totalCount={combined.length}
            timelineOn={timelineOn}
            onToggleTimeline={onToggleTimeline}
            groupBy={groupBy}
            onGroupByChange={setGroupBy}
          />

          {timelineOn && (
            <LvTimeline
              entries={combined}
              range={filters.timeRange}
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
                    <circle cx="6" cy="6" r="4" fill="none" stroke="currentColor" strokeWidth="1.2" />
                    <path d="M9 9 L12 12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                  <input
                    ref={findInputRef}
                    type="text"
                    className="lv-search-input"
                    value={findQ}
                    onChange={(e) => setFindQ(e.target.value)}
                    placeholder="Find in table…"
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

            <div className="lv-stream-hd">
              <span className="lv-sh lv-sh-ln">ln</span>
              <span className="lv-sh lv-sh-caret"></span>
              <span className="lv-sh lv-sh-ts">timestamp</span>
              <span className="lv-sh lv-sh-lvl">level</span>
              <span className="lv-sh lv-sh-svc">service</span>
              <span className="lv-sh lv-sh-file">file</span>
              <span className="lv-sh lv-sh-msg">message</span>
              <span className="lv-sh lv-sh-act"></span>
            </div>

            <div className="lv-stream" ref={streamRef} data-density={tweaks.density}>
              {filtered.length === 0 ? (
                <div className="lv-stream-empty">
                  <div className="lv-stream-empty-title">No matching lines</div>
                  <div className="lv-stream-empty-sub">
                    Try relaxing filters, widening the time range, or clearing the query.
                  </div>
                </div>
              ) : groups ? (
                renderGroupTree(groups, {
                  expandedGroups,
                  toggleGroup: (id) =>
                    setExpandedGroups((s) => {
                      const n = new Set(s);
                      if (n.has(id)) n.delete(id);
                      else n.add(id);
                      return n;
                    }),
                  onFocus: (g) => {
                    setFilters((f) => {
                      const keep = f.fieldFilters.filter(
                        (ff) => !g.path.some((p) => p.field === ff.key),
                      );
                      const add = g.path.map((p) => ({
                        key: p.field,
                        op: '=' as const,
                        value: p.key,
                      }));
                      return { ...f, fieldFilters: [...keep, ...add] };
                    });
                    setGroupBy([]);
                  },
                  onCopy: (g) => {
                    navigator.clipboard?.writeText(g.key);
                  },
                  rowProps: {
                    density: tweaks.density,
                    showDate: tweaks.showDate,
                    wrap: tweaks.wrap,
                    query: filters.query,
                    useRegex: filters.useRegex,
                    caseSensitive: filters.caseSensitive,
                    wholeWord: filters.wholeWord,
                    expanded,
                    bookmarks,
                    toggleExpand,
                    onBookmark,
                    openAtLine,
                    addFieldFilter,
                    theme: tweaks.theme,
                    renderDetailEditor,
                  },
                })
              ) : (
                filtered.map((e, i) => (
                  <LvRow
                    key={e.id}
                    entry={e}
                    index={i}
                    density={tweaks.density}
                    showDate={tweaks.showDate}
                    wrap={tweaks.wrap}
                    query={filters.query}
                    useRegex={filters.useRegex}
                    caseSensitive={filters.caseSensitive}
                    wholeWord={filters.wholeWord}
                    isFindMatch={findOpen && findMatchSet.has(i)}
                    isFindCurrent={findOpen && findMatches[findIdx] === i}
                    selected={false}
                    expanded={expanded.has(e.id)}
                    bookmarked={bookmarks.has(e.id)}
                    onSelect={() => {}}
                    onToggleExpand={() => toggleExpand(e.id)}
                    onBookmark={() => onBookmark(e.id)}
                    onOpenAtLine={openAtLine}
                    onContextMenu={openAtLine}
                    onAddFieldFilter={addFieldFilter}
                    theme={tweaks.theme}
                    renderDetailEditor={renderDetailEditor}
                  />
                ))
              )}
              {liveTail && (
                <div className="lv-live-pulse">
                  <span className="lv-live-dot is-on" />
                  <span>
                    Tailing {activeFileIds.length} file{activeFileIds.length !== 1 ? 's' : ''} ·
                    new lines appear below
                  </span>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {menu && (
        <LvOpenMenu
          entry={menu.entry}
          anchor={{ x: menu.x, y: menu.y }}
          onOpenInApp={() => openInAppPeek(menu.entry)}
          onClose={() => setMenu(null)}
        />
      )}
      {peek && filesById[peek.fileId] && (
        <LvFilePeek
          file={filesById[peek.fileId]!}
          entries={logsByFile[peek.fileId] ?? []}
          line={peek.line}
          onClose={() => setPeek(null)}
          query={filters.query}
          useRegex={filters.useRegex}
          caseSensitive={filters.caseSensitive}
          wholeWord={filters.wholeWord}
        />
      )}
    </div>
  );
};
