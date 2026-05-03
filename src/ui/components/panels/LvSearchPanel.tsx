import { useState } from 'react';
import type { LvSavedSearch } from '../../contracts/lv-types.ts';

export interface LvSearchPanelProps {
  onRun: (query: string) => void;
  readonly savedSearches: ReadonlyArray<LvSavedSearch>;
  onApplyPreset: (preset: LvSavedSearch) => void;
}

export const LvSearchPanel = ({ onRun, savedSearches, onApplyPreset }: LvSearchPanelProps) => {
  const [q, setQ] = useState('');
  return (
    <aside className="lv-sidebar">
      <div className="lv-sb-hd">
        <div className="lv-sb-title">
          <span className="lv-sb-title-text">Search</span>
        </div>
      </div>
      <div className="lv-sb-search">
        <svg viewBox="0 0 14 14" width="12" height="12">
          <circle cx="6" cy="6" r="4" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <path d="M9 9 L12 12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onRun(q)}
          placeholder="Search across all files…"
        />
      </div>
      <div className="lv-search-section">
        <div className="lv-search-section-hd">Saved</div>
        {savedSearches.map((s) => (
          <button
            type="button"
            key={s.id}
            className="lv-search-preset"
            onClick={() => onApplyPreset(s)}
          >
            <span className="lv-search-preset-name">{s.name}</span>
            <span className="lv-search-preset-q">{s.query}</span>
          </button>
        ))}
      </div>
      <div className="lv-search-section">
        <div className="lv-search-section-hd">Tips</div>
        <div className="lv-search-tip">
          <span className="lv-kbd">level:error</span> — filter by level
        </div>
        <div className="lv-search-tip">
          <span className="lv-kbd">status:5</span> — field starts-with
        </div>
        <div className="lv-search-tip">
          <span className="lv-kbd">\bdeadlock\b</span> — with regex on
        </div>
      </div>
    </aside>
  );
};
