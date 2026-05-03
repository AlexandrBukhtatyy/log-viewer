import { useEffect, useState } from 'react';
import type { LvGroupBy } from '../../contracts/lv-types.ts';

interface OptionDef {
  v: LvGroupBy;
  label: string;
  hint: string;
}

const OPTS: OptionDef[] = [
  { v: 'trace_id', label: 'Trace', hint: 'by trace_id' },
  { v: 'req_id', label: 'Request', hint: 'by req_id' },
  { v: 'user_id', label: 'User', hint: 'by user_id' },
  { v: 'service', label: 'Service', hint: 'by service' },
  { v: 'file', label: 'File', hint: 'by source file' },
];

const labelFor = (v: LvGroupBy | string): string =>
  OPTS.find((o) => o.v === v)?.label ?? v;

export interface LvGroupBySelectProps {
  readonly value: ReadonlyArray<LvGroupBy>;
  onChange: (value: LvGroupBy[]) => void;
}

export const LvGroupBySelect = ({ value, onChange }: LvGroupBySelectProps) => {
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

  const toggle = (v: LvGroupBy) => {
    const idx = active.indexOf(v);
    if (idx >= 0) onChange(active.filter((x) => x !== v));
    else onChange([...active, v]);
  };

  const move = (v: LvGroupBy, dir: -1 | 1) => {
    const idx = active.indexOf(v);
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
        ? labelFor(active[0]!)
        : `${labelFor(active[0]!)} › +${active.length - 1}`;

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
              {active.map((v, i) => (
                <div key={v} className="lv-group-chip">
                  <span className="lv-group-chip-num">{i + 1}</span>
                  <span className="lv-group-chip-label">{labelFor(v)}</span>
                  <button
                    type="button"
                    className="lv-group-chip-btn"
                    disabled={i === 0}
                    onClick={(e) => {
                      e.stopPropagation();
                      move(v, -1);
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
                      move(v, 1);
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
                      toggle(v);
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
          {OPTS.map((o) => {
            const on = active.includes(o.v);
            return (
              <button
                key={o.v}
                type="button"
                className={`lv-pop-item${on ? ' is-on' : ''}`}
                onClick={() => toggle(o.v)}
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
                  {o.label}
                </span>
                <span className="lv-pop-q">{o.hint}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
