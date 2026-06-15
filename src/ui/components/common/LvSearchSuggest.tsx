import type { SearchSuggestion } from '../../utils/search-suggest.ts';

export interface LvSearchSuggestProps {
  readonly items: ReadonlyArray<SearchSuggestion>;
  /** Flat index of the highlighted item (keyboard cursor). */
  readonly highlighted: number;
  onHover: (index: number) => void;
  onAccept: (item: SearchSuggestion) => void;
}

/**
 * Presentational autocomplete dropdown for the search box. State (open /
 * highlighted / accept) is owned by the parent input so the same component
 * drives both the filter bar and the Search panel. Renders nothing when
 * there are no suggestions.
 */
export const LvSearchSuggest = ({
  items,
  highlighted,
  onHover,
  onAccept,
}: LvSearchSuggestProps) => {
  if (items.length === 0) return null;
  return (
    <div className="lv-pop lv-suggest" role="listbox">
      {items.map((item, i) => {
        const header =
          i === 0 || items[i - 1]!.group !== item.group ? item.group : null;
        return (
          <div key={`${item.kind}-${item.insert}-${i}`}>
            {header !== null && <div className="lv-suggest-hd">{header}</div>}
            <button
              type="button"
              role="option"
              aria-selected={i === highlighted}
              className={`lv-suggest-item${i === highlighted ? ' is-active' : ''}`}
              // Keep focus on the input — accept on mousedown, not click.
              onMouseDown={(e) => {
                e.preventDefault();
                onAccept(item);
              }}
              onMouseEnter={() => onHover(i)}
            >
              <span className="lv-suggest-label">{item.label}</span>
              {item.hint !== undefined && (
                <span className="lv-suggest-hint">{item.hint}</span>
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
};
