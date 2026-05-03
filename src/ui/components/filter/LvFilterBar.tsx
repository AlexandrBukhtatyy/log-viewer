import { useState } from 'react';
import type {
  LvFilters,
  LvGroupBy,
  LvLogLevel,
  LvSavedSearch,
} from '../../contracts/lv-types.ts';
import { LvLevelPill } from './LvLevelPill.tsx';
import { LvGroupBySelect } from './LvGroupBySelect.tsx';
import { LvAddFieldFilter } from './LvAddFieldFilter.tsx';

const LEVELS: LvLogLevel[] = ['error', 'warn', 'info', 'debug', 'trace'];

export interface LvFilterBarProps {
  readonly filters: LvFilters;
  setFilters: (next: (prev: LvFilters) => LvFilters) => void;
  readonly levelCounts: Partial<Record<LvLogLevel, number>>;
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
}

export const LvFilterBar = ({
  filters,
  setFilters,
  levelCounts,
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
}: LvFilterBarProps) => {
  const [savedOpen, setSavedOpen] = useState(false);

  const toggleLevel = (lvl: LvLogLevel) => {
    setFilters((f) => {
      const next = new Set(f.levels);
      if (next.has(lvl)) next.delete(lvl);
      else next.add(lvl);
      return { ...f, levels: next };
    });
  };
  const setQuery = (q: string) => setFilters((f) => ({ ...f, query: q }));
  const toggleRegex = () => setFilters((f) => ({ ...f, useRegex: !f.useRegex }));
  const toggleCase = () => setFilters((f) => ({ ...f, caseSensitive: !f.caseSensitive }));
  const toggleWord = () => setFilters((f) => ({ ...f, wholeWord: !f.wholeWord }));

  const applyPreset = (p: LvSavedSearch) => {
    setFilters((f) => ({ ...f, query: p.query, levels: new Set(p.levels) }));
    setSavedOpen(false);
  };

  const removeField = (i: number) =>
    setFilters((f) => ({
      ...f,
      fieldFilters: f.fieldFilters.filter((_, idx) => idx !== i),
    }));

  return (
    <div className="lv-fbar">
      <div className="lv-fbar-row">
        <div className="lv-search">
          <svg
            viewBox="0 0 14 14"
            width="13"
            height="13"
            aria-hidden="true"
            className="lv-search-ico"
          >
            <circle cx="6" cy="6" r="4" fill="none" stroke="currentColor" strokeWidth="1.2" />
            <path d="M9 9 L12 12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            className="lv-search-input"
            value={filters.query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              filters.useRegex
                ? 'Regex… e.g. \\btimeout\\b'
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
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <text x="1" y="12" fontSize="9" fontFamily="sans-serif" fontWeight="700" fill="currentColor">
                  A
                </text>
                <text x="7" y="12" fontSize="7" fontFamily="sans-serif" fontWeight="700" fill="currentColor">
                  a
                </text>
              </svg>
            </button>
            <button
              type="button"
              className={`lv-search-tog${filters.wholeWord ? ' is-on' : ''}`}
              onClick={toggleWord}
              title="Match Whole Word (Alt+W)"
              aria-label="Match Whole Word"
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <text x="1" y="11" fontSize="8" fontFamily="sans-serif" fontWeight="700" fill="currentColor">
                  ab
                </text>
                <path d="M1 13 H15" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
            <button
              type="button"
              className={`lv-search-tog${filters.useRegex ? ' is-on' : ''}`}
              onClick={toggleRegex}
              title="Use Regular Expression (Alt+R)"
              aria-label="Regex"
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
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
          {filters.query && (
            <button
              type="button"
              className="lv-search-clear"
              onClick={() => setQuery('')}
              aria-label="Clear"
            >
              ✕
            </button>
          )}
        </div>

        <div className="lv-fbar-spacer" />

        <button
          type="button"
          className={`lv-btn${timelineOn ? ' is-on' : ''}`}
          onClick={onToggleTimeline}
          title="Toggle timeline"
        >
          <svg viewBox="0 0 14 10" width="14" height="10">
            <path
              d="M1 9 L4 4 L7 6 L10 1 L13 5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>Timeline</span>
        </button>

        <LvGroupBySelect value={groupBy} onChange={onGroupByChange} />

        <div className="lv-split">
          <button
            type="button"
            className={`lv-btn${liveTail ? ' is-live' : ''}`}
            onClick={onToggleLiveTail}
            title="Live tail"
          >
            <span className={`lv-live-dot${liveTail ? ' is-on' : ''}`} />
            <span>{liveTail ? 'Live' : 'Live tail'}</span>
          </button>
        </div>

        <div className="lv-saved">
          <button type="button" className="lv-btn" onClick={() => setSavedOpen((v) => !v)}>
            <svg viewBox="0 0 14 14" width="12" height="12">
              <path
                d="M3 2 H11 V12 L7 9.5 L3 12 Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinejoin="round"
              />
            </svg>
            <span>Saved</span>
            <svg viewBox="0 0 8 6" width="8" height="6">
              <path
                d="M1 1 L4 5 L7 1"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
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
                <span className="lv-pop-name" style={{ color: 'var(--lv-accent)' }}>
                  ＋ Save current as preset
                </span>
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="lv-fbar-row lv-fbar-row-2">
        <div className="lv-levels">
          {LEVELS.map((lvl) => (
            <LvLevelPill
              key={lvl}
              level={lvl}
              active={filters.levels.has(lvl)}
              count={levelCounts[lvl] ?? 0}
              onToggle={() => toggleLevel(lvl)}
            />
          ))}
        </div>

        <div className="lv-fbar-sep" />

        <div className="lv-chips">
          {filters.fieldFilters.map((ff, i) => (
            <span
              key={`${ff.key}-${i}`}
              className={`lv-chip${ff.key.startsWith('$') ? ' is-sys' : ''}`}
            >
              <span className="lv-chip-k">{ff.key}</span>
              <span className="lv-chip-op">{ff.op}</span>
              <span className="lv-chip-v">{ff.value}</span>
              <button
                type="button"
                className="lv-chip-x"
                onClick={() => removeField(i)}
                aria-label="Remove"
              >
                ✕
              </button>
            </span>
          ))}
          <LvAddFieldFilter
            onAdd={(ff) =>
              setFilters((f) => ({ ...f, fieldFilters: [...f.fieldFilters, ff] }))
            }
          />
        </div>

        <div className="lv-fbar-spacer-grow" />

        <div className="lv-fbar-count">
          <span className="lv-count-n">{resultCount.toLocaleString()}</span>
          <span className="lv-count-sep">/</span>
          <span className="lv-count-t">{totalCount.toLocaleString()}</span>
          <span className="lv-count-lbl">lines</span>
        </div>
      </div>
    </div>
  );
};
