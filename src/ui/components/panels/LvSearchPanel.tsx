import { useMemo, useState } from 'react';
import type { FieldDescriptor } from '../../../core/filter/field-descriptor.ts';
import type { LvSavedSearch } from '../../contracts/lv-types.ts';
import {
  buildSearchSuggestions,
  splitLastToken,
  type StructuredValue,
} from '../../utils/search-suggest.ts';
import { LvSearchInput } from '../common/LvSearchInput.tsx';

export interface LvSearchPanelProps {
  /**
   * Run the search across all files. Receives the typed query plus the
   * toggle states so the caller can map them onto `LogFilter`
   * (caseSensitive / wholeWord / queryMode).
   */
  onRun: (
    query: string,
    opts: {
      caseSensitive: boolean;
      wholeWord: boolean;
      regex: boolean;
      fts: boolean;
    },
  ) => void;
  readonly savedSearches: ReadonlyArray<LvSavedSearch>;
  onApplyPreset: (preset: LvSavedSearch) => void;
  /** Autocomplete inputs (field values + recent history). */
  readonly fieldDescriptors: ReadonlyArray<FieldDescriptor>;
  readonly recentSearches: ReadonlyArray<string>;
  onSubmitQuery: (query: string) => void;
  /** System/logical `field = value` candidates (autocomplete "Fields" group). */
  readonly structuredValues: ReadonlyArray<StructuredValue>;
  /** Add a structured `key = value` field filter (Fields suggestion accept). */
  onAddFieldFilter: (key: string, value: string) => void;
}

export const LvSearchPanel = ({
  onRun,
  savedSearches,
  onApplyPreset,
  fieldDescriptors,
  recentSearches,
  onSubmitQuery,
  structuredValues,
  onAddFieldFilter,
}: LvSearchPanelProps) => {
  const [q, setQ] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const [fts, setFts] = useState(false);

  const mode = fts ? 'fts' : regex ? 'regex' : 'substring';
  const suggestions = useMemo(
    () =>
      buildSearchSuggestions({
        query: q,
        mode,
        descriptors: fieldDescriptors,
        saved: savedSearches,
        recent: recentSearches,
        structuredValues,
      }),
    [
      q,
      mode,
      fieldDescriptors,
      savedSearches,
      recentSearches,
      structuredValues,
    ],
  );

  const run = (): void => {
    onSubmitQuery(q);
    onRun(q, { caseSensitive, wholeWord, regex, fts });
  };

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
        onRegexChange={(next) => {
          setRegex(next);
          if (next) setFts(false);
        }}
        fts={fts}
        onFtsChange={(next) => {
          setFts(next);
          if (next) setRegex(false);
        }}
        suggest={{
          items: suggestions,
          onAccept: (item) => {
            if (item.filter !== undefined) {
              onAddFieldFilter(item.filter.key, item.filter.value);
              setQ(splitLastToken(q).head.replace(/\s+$/, ''));
            } else if (item.insert !== undefined) {
              setQ(item.insert);
            }
          },
        }}
        onSubmit={run}
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
