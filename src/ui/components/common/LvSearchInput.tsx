import { useEffect, useRef } from 'react';

export interface LvSearchInputProps {
  readonly value: string;
  onChange: (next: string) => void;
  readonly placeholder?: string;

  /**
   * Match-case toggle. Pass both `caseSensitive` and the setter to
   * render the button; omit the setter to hide it.
   */
  readonly caseSensitive?: boolean;
  onCaseSensitiveChange?: (next: boolean) => void;

  readonly wholeWord?: boolean;
  onWholeWordChange?: (next: boolean) => void;

  readonly regex?: boolean;
  onRegexChange?: (next: boolean) => void;

  /** Called on Enter (Shift+Enter is intentionally not handled here). */
  onSubmit?: () => void;
  /** Called on Escape — caller decides whether to close, clear, etc. */
  onEscape?: () => void;

  readonly autoFocus?: boolean;
  readonly className?: string;
}

/**
 * Reusable search input — an icon + input + optional case/word/regex
 * toggles + clear button. Used in:
 *   - Sidebar (filter-by-file-name)
 *   - Search panel (cross-file query)
 *   - LvViewer find-bar
 *
 * Toggles render only when both the value and the setter are wired,
 * so callers that don't need them just leave those props out.
 */
export const LvSearchInput = ({
  value,
  onChange,
  placeholder,
  caseSensitive,
  onCaseSensitiveChange,
  wholeWord,
  onWholeWordChange,
  regex,
  onRegexChange,
  onSubmit,
  onEscape,
  autoFocus,
  className,
}: LvSearchInputProps) => {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) {
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [autoFocus]);

  const showCase = caseSensitive !== undefined && onCaseSensitiveChange !== undefined;
  const showWord = wholeWord !== undefined && onWholeWordChange !== undefined;
  const showRegex = regex !== undefined && onRegexChange !== undefined;

  return (
    <div className={`lv-search${className ? ' ' + className : ''}`}>
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
        ref={inputRef}
        type="text"
        className="lv-search-input"
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onSubmit?.();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onEscape?.();
          }
        }}
      />
      {(showCase || showWord || showRegex) && (
        <div className="lv-search-toggles">
          {showCase && (
            <button
              type="button"
              className={`lv-search-tog${caseSensitive ? ' is-on' : ''}`}
              onClick={() => onCaseSensitiveChange!(!caseSensitive)}
              title="Match Case"
              aria-label="Match Case"
            >
              <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                <text x="1" y="12" fontSize="9" fontFamily="sans-serif" fontWeight="700" fill="currentColor">A</text>
                <text x="7" y="12" fontSize="7" fontFamily="sans-serif" fontWeight="700" fill="currentColor">a</text>
              </svg>
            </button>
          )}
          {showWord && (
            <button
              type="button"
              className={`lv-search-tog${wholeWord ? ' is-on' : ''}`}
              onClick={() => onWholeWordChange!(!wholeWord)}
              title="Match Whole Word"
              aria-label="Match Whole Word"
            >
              <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                <text x="1" y="11" fontSize="8" fontFamily="sans-serif" fontWeight="700" fill="currentColor">ab</text>
                <path d="M1 13 H15" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
          )}
          {showRegex && (
            <button
              type="button"
              className={`lv-search-tog${regex ? ' is-on' : ''}`}
              onClick={() => onRegexChange!(!regex)}
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
          )}
        </div>
      )}
      {value !== '' && (
        <button
          type="button"
          className="lv-clear"
          onClick={() => {
            onChange('');
            inputRef.current?.focus();
          }}
          aria-label="Clear"
          title="Clear"
        >
          ✕
        </button>
      )}
    </div>
  );
};
