import { useEffect, useMemo, useRef, useState } from 'react';
import type { FieldDescriptor } from '../../../core/filter/field-descriptor.ts';
import type { LvGroupBy } from '../../contracts/lv-types.ts';
import { compatBadgeText, compatOf } from '../../utils/field-compatibility.ts';

export interface LvGroupBySelectProps {
  readonly value: ReadonlyArray<LvGroupBy>;
  readonly descriptors: ReadonlyArray<FieldDescriptor>;
  onChange: (value: LvGroupBy[]) => void;
  /** Used to compute compatibility badges (Phase 3). */
  readonly activeSources?: ReadonlyArray<{ id: string; name: string }>;
}

const labelFor = (
  key: LvGroupBy,
  descriptors: ReadonlyArray<FieldDescriptor>,
): string => {
  const d = descriptors.find((x) => x.key === key);
  return d?.label || key;
};

const sortDescriptors = (
  descriptors: ReadonlyArray<FieldDescriptor>,
): ReadonlyArray<FieldDescriptor> => {
  const dyn = descriptors.filter((d) => d.origin === 'dynamic').slice();
  dyn.sort((a, b) => {
    const aRate = a.presenceRate ?? 0;
    const bRate = b.presenceRate ?? 0;
    if (aRate !== bRate) return bRate - aRate;
    const aOcc = a.occurrences ?? 0;
    const bOcc = b.occurrences ?? 0;
    if (aOcc !== bOcc) return bOcc - aOcc;
    return a.key.localeCompare(b.key);
  });
  const builtin = descriptors.filter((d) => d.origin === 'builtin');
  return [...dyn, ...builtin];
};

/**
 * Group-by picker — classic combobox: a closed field with a chevron,
 * a dropdown that opens on focus/click and shows a (typeable)
 * filtered list. Selecting an option toggles the key in the active
 * groupings and closes the dropdown.
 *
 * Active groupings live below the combobox as ordered chips with
 * ↑/↓/× controls.
 */
export const LvGroupBySelect = ({
  value,
  descriptors,
  onChange,
  activeSources,
}: LvGroupBySelectProps) => {
  const activeIds = useMemo(
    () => (activeSources ?? []).map((s) => s.id),
    [activeSources],
  );
  const sourceNameById = useMemo(
    () => new Map((activeSources ?? []).map((s) => [s.id, s.name])),
    [activeSources],
  );
  const [open, setOpen] = useState(false);
  const [comboOpen, setComboOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightedIdx, setHighlightedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const active = Array.isArray(value) ? value : [];

  // Outside-click closes the whole popover (and the combobox along
  // with it).
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest?.('.lv-group-sel')) {
        setOpen(false);
        setComboOpen(false);
        setQuery('');
        setHighlightedIdx(0);
      }
    };
    const t = setTimeout(() => document.addEventListener('mousedown', onDoc), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDoc);
    };
  }, [open]);

  const closePopover = () => {
    setOpen(false);
    setComboOpen(false);
    setQuery('');
    setHighlightedIdx(0);
  };

  const sorted = useMemo(() => sortDescriptors(descriptors), [descriptors]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return sorted;
    return sorted.filter((d) => {
      return (
        d.key.toLowerCase().includes(q) ||
        (d.label ?? '').toLowerCase().includes(q)
      );
    });
  }, [sorted, query]);

  // Derived clamp — never trust raw `highlightedIdx` against the
  // currently filtered list (changes synchronously when query updates).
  const effectiveIdx =
    filtered.length === 0
      ? 0
      : Math.min(Math.max(0, highlightedIdx), filtered.length - 1);

  const toggle = (k: LvGroupBy) => {
    const idx = active.indexOf(k);
    if (idx >= 0) onChange(active.filter((x) => x !== k));
    else onChange([...active, k]);
    // Stay open and focused so the user can pick / unpick more
    // fields without re-clicking the combobox. Query is cleared so
    // the next selection starts from the full list.
    setQuery('');
    setHighlightedIdx(0);
    inputRef.current?.focus();
  };

  const move = (k: LvGroupBy, dir: -1 | 1) => {
    const idx = active.indexOf(k);
    if (idx < 0) return;
    const target = idx + dir;
    if (target < 0 || target >= active.length) return;
    const next = active.slice();
    [next[idx], next[target]] = [next[target]!, next[idx]!];
    onChange(next);
  };

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!comboOpen) setComboOpen(true);
      else setHighlightedIdx((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!comboOpen) {
        setComboOpen(true);
        return;
      }
      const target = filtered[effectiveIdx];
      if (target) toggle(target.key);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (comboOpen) {
        setComboOpen(false);
        setQuery('');
      } else {
        closePopover();
      }
    }
  };

  // Keep highlighted item visible inside the scrollable list.
  useEffect(() => {
    if (!comboOpen) return;
    const el = listRef.current?.querySelector<HTMLElement>(
      '.lv-group-search-item.is-active',
    );
    el?.scrollIntoView({ block: 'nearest' });
  }, [effectiveIdx, comboOpen]);

  const label =
    active.length === 0
      ? 'No grouping'
      : active.length === 1
        ? labelFor(active[0]!, descriptors)
        : `${labelFor(active[0]!, descriptors)} › +${active.length - 1}`;

  return (
    <div className="lv-group-sel">
      <button
        type="button"
        className={`lv-btn${active.length > 0 ? ' is-on' : ''}`}
        onClick={() => {
          if (open) closePopover();
          else setOpen(true);
        }}
        title="Group logs by fields (stack multiple for nested groups)"
      >
        <svg viewBox="0 0 14 14" width="13" height="13">
          <rect x="1.5" y="2" width="11" height="2" rx="1" fill="currentColor" opacity=".9" />
          <rect x="3" y="6" width="9.5" height="1.5" rx=".7" fill="currentColor" opacity=".6" />
          <rect x="3" y="9" width="9.5" height="1.5" rx=".7" fill="currentColor" opacity=".6" />
          <rect x="3" y="12" width="6" height="1.5" rx=".7" fill="currentColor" opacity=".6" />
        </svg>
        <span>
          Group: <b style={{ fontWeight: 600 }}>{label}</b>
        </span>
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
      {open && (
        <div className="lv-pop lv-group-pop" style={{ minWidth: 280 }}>
          <div className="lv-pop-hd">
            <span>Group by</span>
            {active.length > 0 && (
              <button type="button" className="lv-pop-clear" onClick={() => onChange([])}>
                Clear
              </button>
            )}
          </div>

          {sorted.length === 0 ? (
            <div className="lv-pop-empty">No fields yet — pick a source.</div>
          ) : (
            <div className={`lv-combo${comboOpen ? ' is-open' : ''}`}>
              <div className="lv-combo-row">
                <input
                  ref={inputRef}
                  type="text"
                  className="lv-combo-input"
                  placeholder="Pick a field to add…"
                  value={query}
                  role="combobox"
                  aria-expanded={comboOpen}
                  aria-autocomplete="list"
                  onFocus={() => setComboOpen(true)}
                  onClick={() => setComboOpen(true)}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setHighlightedIdx(0);
                    setComboOpen(true);
                  }}
                  onKeyDown={onSearchKeyDown}
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="lv-combo-chevron"
                  tabIndex={-1}
                  aria-label={comboOpen ? 'Close list' : 'Open list'}
                  onMouseDown={(e) => {
                    // Don't blur the input — toggle directly so click
                    // on chevron acts like a focus toggle.
                    e.preventDefault();
                    if (comboOpen) {
                      setComboOpen(false);
                    } else {
                      setComboOpen(true);
                      inputRef.current?.focus();
                    }
                  }}
                >
                  <svg viewBox="0 0 10 6" width="10" height="6" aria-hidden="true">
                    <path
                      d="M1 1 L5 5 L9 1"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
              {comboOpen && (
                <div className="lv-combo-pop">
                  {filtered.length === 0 ? (
                    <div className="lv-pop-empty">No fields match “{query}”.</div>
                  ) : (
                    <div className="lv-group-search-list" ref={listRef}>
                      {filtered.map((d, idx) => {
                        const on = active.includes(d.key);
                        const isHi = idx === effectiveIdx;
                        const isSys = d.origin === 'builtin';
                        return (
                          <div
                            key={d.key}
                            role="option"
                            aria-selected={on}
                            className={
                              'lv-group-search-item' +
                              (isHi ? ' is-active' : '') +
                              (on ? ' is-on' : '') +
                              (isSys ? ' is-sys' : '')
                            }
                            onMouseEnter={() => setHighlightedIdx(idx)}
                            // Use mousedown so the click lands before
                            // the input's blur cancels the dropdown.
                            onMouseDown={(e) => {
                              e.preventDefault();
                              toggle(d.key);
                            }}
                          >
                            <span className="lv-group-search-key">
                              {isSys && <span className="lv-group-search-sys">{d.key}</span>}
                              {d.label || d.key}
                            </span>
                            {(() => {
                              const c = compatOf(d, activeIds);
                              const txt = compatBadgeText(c, sourceNameById);
                              return txt !== null ? (
                                <span
                                  className={`lv-fld-compat lv-fld-compat-${c.kind}`}
                                  title={
                                    c.kind === 'unique'
                                      ? `Field exists only in ${c.presentSources
                                          .map((id) => sourceNameById.get(id) ?? id)
                                          .join(', ')}`
                                      : `Field present in ${c.presentIn} of ${c.total} active sources`
                                  }
                                >
                                  {txt}
                                </span>
                              ) : null;
                            })()}
                            <span className="lv-group-search-meta">
                              {d.origin === 'dynamic' && d.presenceRate !== undefined
                                ? `${Math.round(d.presenceRate * 100)}%`
                                : d.type}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {active.length > 0 && (
            <div className="lv-group-order">
              {active.map((k, i) => (
                <div key={k} className="lv-group-chip">
                  <span className="lv-group-chip-num">{i + 1}</span>
                  <span className="lv-group-chip-label">{labelFor(k, descriptors)}</span>
                  <button
                    type="button"
                    className="lv-group-chip-btn"
                    disabled={i === 0}
                    onClick={(e) => {
                      e.stopPropagation();
                      move(k, -1);
                    }}
                    title="Move up"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="lv-group-chip-btn"
                    disabled={i === active.length - 1}
                    onClick={(e) => {
                      e.stopPropagation();
                      move(k, 1);
                    }}
                    title="Move down"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="lv-group-chip-btn lv-group-chip-x"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(k);
                    }}
                    title="Remove"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
