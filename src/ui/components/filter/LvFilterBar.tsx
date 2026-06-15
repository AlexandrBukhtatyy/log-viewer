import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Activity,
  Bookmark,
  CaseSensitive,
  Check,
  ChevronDown,
  Copy,
  ListFilter,
  Regex,
  Search,
  WholeWord,
  X,
} from 'lucide-react';
import type {
  LogFilter,
  LogLevel,
  QueryMode,
} from '../../../core/types/index.ts';
import type { FieldDescriptor } from '../../../core/filter/field-descriptor.ts';
import type {
  LvColumnPref,
  LvFileNode,
  LvGroupBy,
  LvSavedSearch,
  LvTweaks,
} from '../../contracts/lv-types.ts';
import { compatOf } from '../../utils/field-compatibility.ts';
import {
  buildSearchSuggestions,
  type SearchSuggestion,
} from '../../utils/search-suggest.ts';
import { LvSearchSuggest } from '../common/LvSearchSuggest.tsx';
import { LvGroupBySelect } from './LvGroupBySelect.tsx';
import { LvAddFieldFilter } from './LvAddFieldFilter.tsx';
import { LvTableSettings } from './LvTableSettings.tsx';

const ALL_LEVELS: ReadonlyArray<LogLevel> = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'unknown',
];

const isAllLevels = (levels: ReadonlyArray<LogLevel> | null): boolean =>
  levels === null ||
  (levels.length === ALL_LEVELS.length &&
    ALL_LEVELS.every((l) => levels.includes(l)));

export interface LvFilterBarProps {
  readonly filters: LogFilter;
  setFilters: (next: (prev: LogFilter) => LogFilter) => void;
  readonly levelCounts: Partial<Record<LogLevel, number>>;
  readonly savedSearches: ReadonlyArray<LvSavedSearch>;
  readonly liveTail: boolean;
  onToggleLiveTail: () => void;
  onSaveSearch: () => void;
  readonly resultCount: number;
  readonly totalCount: number;
  readonly timelineOn: boolean;
  onToggleTimeline: () => void;
  readonly groupBy: ReadonlyArray<LvGroupBy>;
  onGroupByChange: (next: LvGroupBy[]) => void;
  /** Recent submitted queries (autocomplete "Recent" group). */
  readonly recentSearches: ReadonlyArray<string>;
  /** Record a query in the recent-search history (called on submit). */
  onSubmitQuery: (query: string) => void;
  /**
   * Per-tab rules ("apply to other tabs"). Enabled only when a real file tab
   * is active (the `__all__` aggregate owns the global defaults and has no
   * rules to copy). `tabsForApply` are the other open file tabs the active
   * tab's filter/sort/group-by can be copied onto.
   */
  readonly applyRulesEnabled: boolean;
  readonly tabsForApply: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
  }>;
  onApplyRulesToTabs: (target: 'all' | { ids: string[] }) => void;
  onResetTabRules: () => void;
  readonly fieldDescriptors: ReadonlyArray<FieldDescriptor>;
  readonly tweaks: LvTweaks;
  setTweak: <K extends keyof LvTweaks>(key: K, value: LvTweaks[K]) => void;
  readonly columns: ReadonlyArray<LvColumnPref>;
  onColumnsChange: (next: ReadonlyArray<LvColumnPref>) => void;
  /**
   * Maps every catalog source id to its tree-node (name + kind etc.).
   * Used by the compatibility badges that flag fields living only in
   * a subset of active sources (Phase 3).
   */
  readonly filesById?: Readonly<Record<string, LvFileNode>>;
}

export const LvFilterBar = ({
  filters,
  setFilters,
  savedSearches,
  liveTail,
  onToggleLiveTail,
  onSaveSearch,
  resultCount,
  totalCount,
  timelineOn,
  onToggleTimeline,
  groupBy,
  onGroupByChange,
  recentSearches,
  onSubmitQuery,
  applyRulesEnabled,
  tabsForApply,
  onApplyRulesToTabs,
  onResetTabRules,
  fieldDescriptors,
  tweaks,
  setTweak,
  columns,
  onColumnsChange,
  filesById,
}: LvFilterBarProps) => {
  const [savedOpen, setSavedOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [checkedIds, setCheckedIds] = useState<ReadonlySet<string>>(new Set());
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const filtersRef = useRef<HTMLDivElement>(null);
  const savedRef = useRef<HTMLDivElement>(null);
  const applyRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  const suggestions = useMemo(
    () =>
      buildSearchSuggestions({
        query: filters.query,
        mode: filters.queryMode,
        descriptors: fieldDescriptors,
        saved: savedSearches,
        recent: recentSearches,
      }),
    [
      filters.query,
      filters.queryMode,
      fieldDescriptors,
      savedSearches,
      recentSearches,
    ],
  );
  const showSuggest = suggestOpen && suggestions.length > 0;

  // Compose the active-source set for compatibility badges. `null`
  // in filters.sources means "every catalog source"; we fall back to
  // the keys of `filesById` in that case so the picker can still tell
  // the user that `req_id` is unique to pino vs. nginx.
  const activeSources = useMemo<
    ReadonlyArray<{ id: string; name: string }>
  >(() => {
    if (!filesById) return [];
    const ids =
      filters.sources && filters.sources.length > 0
        ? filters.sources
        : (Object.keys(filesById) as ReadonlyArray<string>);
    return ids.map((id) => ({
      id,
      name: filesById[id]?.name ?? id,
    }));
  }, [filesById, filters.sources]);
  const sourceNameById = useMemo(
    () => new Map(activeSources.map((s) => [s.id, s.name])),
    [activeSources],
  );
  const descByKey = useMemo(
    () => new Map(fieldDescriptors.map((d) => [d.key, d])),
    [fieldDescriptors],
  );

  const fieldFilters = filters.fieldFilters ?? [];
  const activeFieldsCount = fieldFilters.length;
  const filtersBadge = activeFieldsCount;

  useEffect(() => {
    if (!filtersOpen && !savedOpen && !applyOpen && !suggestOpen) return;
    const onDoc = (e: MouseEvent): void => {
      const t = e.target as Node;
      if (
        filtersOpen &&
        filtersRef.current &&
        !filtersRef.current.contains(t)
      ) {
        setFiltersOpen(false);
      }
      if (savedOpen && savedRef.current && !savedRef.current.contains(t)) {
        setSavedOpen(false);
      }
      if (applyOpen && applyRef.current && !applyRef.current.contains(t)) {
        setApplyOpen(false);
      }
      if (suggestOpen && searchRef.current && !searchRef.current.contains(t)) {
        setSuggestOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setFiltersOpen(false);
        setSavedOpen(false);
        setApplyOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [filtersOpen, savedOpen, applyOpen, suggestOpen]);

  // Accept a suggestion. Text suggestions set the query; structured `field`
  // ones add a field filter and strip the trigger token (wired in a later
  // step). For now, text suggestions only.
  const acceptSuggestion = (item: SearchSuggestion): void => {
    if (item.insert !== undefined) {
      setFilters((f) => ({ ...f, query: item.insert! }));
    }
    setHighlighted(-1);
    setSuggestOpen(false);
  };

  const onSearchKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!showSuggest) {
        setSuggestOpen(true);
        setHighlighted(0);
        return;
      }
      setHighlighted((h) => Math.min(suggestions.length - 1, h + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((h) => Math.max(0, h - 1));
    } else if (e.key === 'Enter') {
      if (showSuggest && highlighted >= 0 && highlighted < suggestions.length) {
        e.preventDefault();
        acceptSuggestion(suggestions[highlighted]!);
        return;
      }
      onSubmitQuery(filters.query);
      setSuggestOpen(false);
    } else if (e.key === 'Escape') {
      if (showSuggest) {
        e.stopPropagation();
        setSuggestOpen(false);
      }
    }
  };

  const toggleChecked = (id: string) =>
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const closeApply = () => {
    setApplyOpen(false);
    setCheckedIds(new Set());
  };

  const setQuery = (q: string) => setFilters((f) => ({ ...f, query: q }));
  const toggleCase = () =>
    setFilters((f) => ({ ...f, caseSensitive: !f.caseSensitive }));
  const toggleWord = () =>
    setFilters((f) => ({ ...f, wholeWord: !f.wholeWord }));
  const toggleMode = (mode: QueryMode) =>
    setFilters((f) => ({
      ...f,
      queryMode: f.queryMode === mode ? 'substring' : mode,
    }));

  const applyPreset = (p: LvSavedSearch) => {
    setFilters((f) => ({
      ...f,
      query: p.query,
      levels: isAllLevels(p.levels) ? null : p.levels,
    }));
    setSavedOpen(false);
  };

  const removeField = (i: number) =>
    setFilters((f) => ({
      ...f,
      fieldFilters: (f.fieldFilters ?? []).filter((_, idx) => idx !== i),
    }));
  const clearFieldFilters = () =>
    setFilters((f) => ({ ...f, fieldFilters: [] }));

  return (
    <div className="lv-fbar">
      <div className="lv-fbar-row">
        <div className="lv-split">
          <button
            type="button"
            className={`lv-btn lv-btn-icon${liveTail ? ' is-live' : ''}`}
            onClick={onToggleLiveTail}
            title={liveTail ? 'Live tail (on)' : 'Live tail'}
            aria-label="Live tail"
            aria-pressed={liveTail}
          >
            <span className={`lv-live-dot${liveTail ? ' is-on' : ''}`} />
          </button>
        </div>

        <div className="lv-search" ref={searchRef}>
          <Search
            className="lv-search-ico"
            size={13}
            strokeWidth={1.5}
            aria-hidden="true"
          />
          <input
            type="text"
            className="lv-search-input"
            value={filters.query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSuggestOpen(true);
              setHighlighted(-1);
            }}
            onFocus={() => setSuggestOpen(true)}
            onKeyDown={onSearchKeyDown}
            role="combobox"
            aria-expanded={showSuggest}
            aria-autocomplete="list"
            placeholder={
              filters.queryMode === 'regex'
                ? 'Regex… e.g. \\btimeout\\b'
                : filters.queryMode === 'fts'
                  ? 'FTS… "out of memory" OR error -debug'
                  : 'Search logs across selected files…'
            }
            spellCheck={false}
          />
          <div className="lv-search-toggles">
            <button
              type="button"
              className={`lv-search-tog${filters.caseSensitive ? ' is-on' : ''}`}
              onClick={toggleCase}
              title="Match Case (Alt+C)"
              aria-label="Match Case"
            >
              <CaseSensitive size={14} strokeWidth={1.75} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`lv-search-tog${filters.wholeWord ? ' is-on' : ''}`}
              onClick={toggleWord}
              title="Match Whole Word (Alt+W)"
              aria-label="Match Whole Word"
            >
              <WholeWord size={14} strokeWidth={1.75} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`lv-search-tog${filters.queryMode === 'regex' ? ' is-on' : ''}`}
              onClick={() => toggleMode('regex')}
              title="Regular Expression (Alt+R)"
              aria-label="Regex query mode"
            >
              <Regex size={14} strokeWidth={1.75} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`lv-search-tog${filters.queryMode === 'fts' ? ' is-on' : ''}`}
              onClick={() => toggleMode('fts')}
              title="Full-text search (FTS5 grammar — phrases, AND, OR, NOT)"
              aria-label="FTS5 query mode"
            >
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  fontFamily: 'sans-serif',
                }}
              >
                FTS
              </span>
            </button>
          </div>
          {filters.query && (
            <button
              type="button"
              className="lv-search-clear"
              onClick={() => setQuery('')}
              aria-label="Clear"
            >
              <X size={12} strokeWidth={2} aria-hidden="true" />
            </button>
          )}
          {showSuggest && (
            <LvSearchSuggest
              items={suggestions}
              highlighted={highlighted}
              onHover={setHighlighted}
              onAccept={acceptSuggestion}
            />
          )}
        </div>

        <div className="lv-fbar-count">
          <span className="lv-count-n">{resultCount.toLocaleString()}</span>
          <span className="lv-count-sep">/</span>
          <span className="lv-count-t">{totalCount.toLocaleString()}</span>
        </div>

        <div className="lv-fbar-spacer" />

        <button
          type="button"
          className={`lv-btn lv-btn-icon${timelineOn ? ' is-on' : ''}`}
          onClick={onToggleTimeline}
          title="Toggle timeline"
          aria-label="Toggle timeline"
          aria-pressed={timelineOn}
        >
          <Activity size={14} strokeWidth={1.5} aria-hidden="true" />
        </button>

        <LvGroupBySelect
          value={groupBy}
          descriptors={fieldDescriptors}
          onChange={onGroupByChange}
          activeSources={activeSources}
        />

        <div className="lv-fbtn-wrap" ref={filtersRef}>
          <button
            type="button"
            className={`lv-btn${filtersBadge > 0 ? ' is-on' : ''}`}
            onClick={() => setFiltersOpen((v) => !v)}
            title="Filters"
            aria-haspopup="dialog"
            aria-expanded={filtersOpen}
          >
            <ListFilter size={13} strokeWidth={1.5} aria-hidden="true" />
            <span>Filters</span>
            {filtersBadge > 0 && (
              <span className="lv-btn-badge">{filtersBadge}</span>
            )}
            <ChevronDown size={12} strokeWidth={1.75} aria-hidden="true" />
          </button>
          {filtersOpen && (
            <div className="lv-pop lv-filters-pop" role="dialog">
              <div className="lv-pop-hd">
                <span>Field filters</span>
                {activeFieldsCount > 0 && (
                  <button
                    type="button"
                    className="lv-pop-clear"
                    onClick={clearFieldFilters}
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="lv-chips lv-filters-chips">
                {fieldFilters.map((ff, i) => {
                  const desc = descByKey.get(ff.key);
                  const activeIds = activeSources.map((s) => s.id);
                  const compat = desc
                    ? compatOf(desc, activeIds)
                    : {
                        kind: 'shared' as const,
                        presentIn: 0,
                        total: 0,
                        presentSources: [],
                        missingSources: [],
                      };
                  const isLossy =
                    compat.kind === 'unique' || compat.kind === 'partial';
                  const missingNames = compat.missingSources
                    .map((id) => sourceNameById.get(id) ?? id)
                    .join(', ');
                  return (
                    <span
                      key={`${ff.key}-${i}`}
                      className={`lv-chip${ff.key.startsWith('$') ? ' is-sys' : ''}${isLossy ? ' is-lossy' : ''}`}
                    >
                      <span className="lv-chip-k">{ff.key}</span>
                      <span className="lv-chip-op">{ff.op}</span>
                      <span className="lv-chip-v">{ff.value}</span>
                      {isLossy && (
                        <span
                          className="lv-chip-warn"
                          title={`Field present in ${compat.presentIn} of ${compat.total} active sources — excludes ${missingNames || 'unknown sources'}`}
                          aria-label="Field is not shared across sources"
                        >
                          ⚠
                        </span>
                      )}
                      <button
                        type="button"
                        className="lv-chip-x"
                        onClick={() => removeField(i)}
                        aria-label="Remove"
                      >
                        <X size={10} strokeWidth={2} aria-hidden="true" />
                      </button>
                    </span>
                  );
                })}
                <LvAddFieldFilter
                  descriptors={fieldDescriptors}
                  onAdd={(ff) =>
                    setFilters((f) => ({
                      ...f,
                      fieldFilters: [...(f.fieldFilters ?? []), ff],
                    }))
                  }
                  activeSources={activeSources}
                />
              </div>
            </div>
          )}
        </div>

        {applyRulesEnabled && (
          <div className="lv-fbtn-wrap" ref={applyRef}>
            <button
              type="button"
              className="lv-btn"
              onClick={() => setApplyOpen((v) => !v)}
              title="Apply this tab's filter / sort / grouping to other tabs"
              aria-haspopup="menu"
              aria-expanded={applyOpen}
            >
              <Copy size={12} strokeWidth={1.5} aria-hidden="true" />
              <span>Tabs</span>
              <ChevronDown size={12} strokeWidth={1.75} aria-hidden="true" />
            </button>
            {applyOpen && (
              <div className="lv-pop lv-apply-pop" role="menu">
                <div className="lv-pop-hd">
                  <span>Copy filter · sort · grouping</span>
                </div>
                <button
                  type="button"
                  className="lv-pop-item lv-pop-item-row"
                  disabled={tabsForApply.length === 0}
                  onClick={() => {
                    onApplyRulesToTabs('all');
                    closeApply();
                  }}
                >
                  <span className="lv-pop-ico" aria-hidden="true">
                    <Copy size={13} strokeWidth={1.75} />
                  </span>
                  <span className="lv-pop-name">Apply to all tabs</span>
                  <span className="lv-pop-count">{tabsForApply.length}</span>
                </button>

                {tabsForApply.length > 0 && (
                  <>
                    <div className="lv-pop-sub">Or pick tabs</div>
                    {tabsForApply.map((t) => {
                      const on = checkedIds.has(t.id);
                      return (
                        <button
                          type="button"
                          key={t.id}
                          className={`lv-pop-item lv-pop-item-row${on ? ' is-on' : ''}`}
                          aria-pressed={on}
                          onClick={() => toggleChecked(t.id)}
                        >
                          <span className={`lv-chk${on ? ' is-on' : ''}`}>
                            {on && (
                              <Check
                                size={11}
                                strokeWidth={3}
                                aria-hidden="true"
                              />
                            )}
                          </span>
                          <span className="lv-pop-name">{t.name}</span>
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      className="lv-btn lv-apply-go"
                      disabled={checkedIds.size === 0}
                      onClick={() => {
                        onApplyRulesToTabs({ ids: [...checkedIds] });
                        closeApply();
                      }}
                    >
                      Apply to {checkedIds.size} selected
                    </button>
                  </>
                )}

                <div className="lv-pop-sep" />
                <button
                  type="button"
                  className="lv-pop-item lv-pop-item-row"
                  onClick={() => {
                    onResetTabRules();
                    closeApply();
                  }}
                >
                  <span className="lv-pop-ico" aria-hidden="true">
                    <X size={13} strokeWidth={1.75} />
                  </span>
                  <span className="lv-pop-name">Reset to global defaults</span>
                </button>
              </div>
            )}
          </div>
        )}

        <div className="lv-saved" ref={savedRef}>
          <button
            type="button"
            className="lv-btn"
            onClick={() => setSavedOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={savedOpen}
          >
            <Bookmark size={12} strokeWidth={1.5} aria-hidden="true" />
            <span>Saved</span>
            <ChevronDown size={12} strokeWidth={1.75} aria-hidden="true" />
          </button>
          {savedOpen && (
            <div className="lv-pop">
              <div className="lv-pop-hd">Saved searches</div>
              {savedSearches.map((s) => (
                <button
                  type="button"
                  key={s.id}
                  className="lv-pop-item"
                  onClick={() => applyPreset(s)}
                >
                  <span className="lv-pop-name">{s.name}</span>
                  <span className="lv-pop-q">{s.query}</span>
                </button>
              ))}
              <div className="lv-pop-sep" />
              <button
                type="button"
                className="lv-pop-item"
                onClick={() => {
                  setSavedOpen(false);
                  onSaveSearch();
                }}
              >
                <span
                  className="lv-pop-name"
                  style={{ color: 'var(--lv-accent)' }}
                >
                  ＋ Save current as preset
                </span>
              </button>
            </div>
          )}
        </div>

        <LvTableSettings
          tweaks={tweaks}
          setTweak={setTweak}
          columns={columns}
          descriptors={fieldDescriptors}
          onColumnsChange={onColumnsChange}
          activeSources={activeSources}
        />
      </div>
    </div>
  );
};
