import { useEffect, useMemo, useState } from 'react';
import type { FieldDescriptor } from '../../../core/filter/field-descriptor.ts';
import type { LvGroupBy } from '../../contracts/lv-types.ts';

export interface LvGroupBySelectProps {
  readonly value: ReadonlyArray<LvGroupBy>;
  readonly descriptors: ReadonlyArray<FieldDescriptor>;
  onChange: (value: LvGroupBy[]) => void;
}

const labelFor = (
  key: LvGroupBy,
  descriptors: ReadonlyArray<FieldDescriptor>,
): string => {
  const d = descriptors.find((x) => x.key === key);
  return d?.label || key;
};

/**
 * Group-by picker (ADR-0017 Phase 6) — same shape as before, but
 * options now come from `coordinator.getFieldSchema` instead of a
 * hard-coded list. Order: dynamic descriptors by `presenceRate` DESC,
 * then `occurrences` DESC; built-ins follow in catalog order.
 */
export const LvGroupBySelect = ({
  value,
  descriptors,
  onChange,
}: LvGroupBySelectProps) => {
  const [open, setOpen] = useState(false);
  const active = Array.isArray(value) ? value : [];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest?.('.lv-group-sel')) setOpen(false);
    };
    const t = setTimeout(() => document.addEventListener('mousedown', onDoc), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDoc);
    };
  }, [open]);

  const options = useMemo(() => {
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
  }, [descriptors]);

  const toggle = (k: LvGroupBy) => {
    const idx = active.indexOf(k);
    if (idx >= 0) onChange(active.filter((x) => x !== k));
    else onChange([...active, k]);
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
        onClick={() => setOpen((v) => !v)}
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
        <div className="lv-pop lv-group-pop" style={{ minWidth: 260 }}>
          <div className="lv-pop-hd">
            <span>Group by</span>
            {active.length > 0 && (
              <button type="button" className="lv-pop-clear" onClick={() => onChange([])}>
                Clear
              </button>
            )}
          </div>
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
          <div className="lv-pop-sub">Add level</div>
          {options.length === 0 ? (
            <div className="lv-pop-empty">No fields yet — pick a source.</div>
          ) : (
            options.map((d) => {
              const on = active.includes(d.key);
              return (
                <button
                  key={d.key}
                  type="button"
                  className={`lv-pop-item${on ? ' is-on' : ''}`}
                  onClick={() => toggle(d.key)}
                >
                  <span className="lv-pop-name">
                    <span className={`lv-chk${on ? ' is-on' : ''}`}>
                      {on && (
                        <svg viewBox="0 0 10 10" width="8" height="8">
                          <path
                            d="M1.5 5 L4 7.5 L8.5 2.5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </span>
                    {d.label || d.key}
                  </span>
                  <span className="lv-pop-q">
                    {d.origin === 'dynamic' && d.presenceRate !== undefined
                      ? `${Math.round(d.presenceRate * 100)}%`
                      : d.type}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
