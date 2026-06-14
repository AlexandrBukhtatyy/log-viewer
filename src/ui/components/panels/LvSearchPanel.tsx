import { useState } from 'react';
import type { LvSavedSearch } from '../../contracts/lv-types.ts';
import { LvSearchInput } from '../common/LvSearchInput.tsx';

export interface LvSearchPanelProps {
  /**
   * Run the search across all files. Receives the typed query plus the
   * three toggle states so the caller can map them onto `LogFilter`
   * (caseSensitive / wholeWord / queryMode='regex').
   */
  onRun: (
    query: string,
    opts: { caseSensitive: boolean; wholeWord: boolean; regex: boolean },
  ) => void;
  readonly savedSearches: ReadonlyArray<LvSavedSearch>;
  onApplyPreset: (preset: LvSavedSearch) => void;
}

export const LvSearchPanel = ({
  onRun,
  savedSearches,
  onApplyPreset,
}: LvSearchPanelProps) => {
  const [q, setQ] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);

  return (
    <aside className="lv-sidebar">
      <div className="lv-sb-hd">
        <div className="lv-sb-title">
          <span className="lv-sb-title-text">Search</span>
        </div>
      </div>
      <LvSearchInput
        className="lv-search--block"
        value={q}
        onChange={setQ}
        placeholder="Search across all files…"
        caseSensitive={caseSensitive}
        onCaseSensitiveChange={setCaseSensitive}
        wholeWord={wholeWord}
        onWholeWordChange={setWholeWord}
        regex={regex}
        onRegexChange={setRegex}
        onSubmit={() => onRun(q, { caseSensitive, wholeWord, regex })}
        autoFocus
      />
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
