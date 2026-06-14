import { useEffect, useMemo, useRef, useState } from 'react';
import type { FieldDescriptor } from '../../../core/filter/field-descriptor.ts';
import type { LvColumnPref } from '../../contracts/lv-types.ts';
import { builtInColumn } from '../../contracts/lv-column-registry.tsx';

const DEFAULT_WIDTH_PX = 140;

export interface LvColumnPickerProps {
  readonly columns: ReadonlyArray<LvColumnPref>;
  readonly descriptors: ReadonlyArray<FieldDescriptor>;
  onChange: (next: ReadonlyArray<LvColumnPref>) => void;
}

/**
 * Popover-style column picker. Renders one checkbox per available
 * field descriptor (built-in `@`-attributes + dynamic JSON keys
 * harvested from `field_meta`); checked items become extra columns
 * appended after the fixed FILE column.
 *
 * Sorting: dynamic descriptors come first, ordered by `presenceRate`
 * DESC (then by occurrences); built-ins follow in catalog order.
 * Keeps "high-signal" picks at the top while still letting the user
 * reach for `@source.kind` etc. without scrolling.
 */
export const LvColumnPicker = ({
  columns,
  descriptors,
  onChange,
}: LvColumnPickerProps) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const selectedKeys = useMemo(
    () => new Set(columns.map((c) => c.key)),
    [columns],
  );

  const sortedDescriptors = useMemo(() => {
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
    const logical = descriptors.filter((d) => d.origin === 'logical');
    return { dynamic: dyn, builtin, logical };
  }, [descriptors]);

  const toggle = (key: string) => {
    if (selectedKeys.has(key)) {
      onChange(columns.filter((c) => c.key !== key));
    } else {
      const widthPx = builtInColumn(key)?.defaultWidthPx ?? DEFAULT_WIDTH_PX;
      onChange([...columns, { key, widthPx }]);
    }
  };

  const move = (key: string, dir: -1 | 1) => {
    const idx = columns.findIndex((c) => c.key === key);
    if (idx < 0) return;
    const next = [...columns];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    const tmp = next[idx]!;
    next[idx] = next[swap]!;
    next[swap] = tmp;
    onChange(next);
  };

  const renderRow = (d: FieldDescriptor) => {
    const checked = selectedKeys.has(d.key);
    const idx = columns.findIndex((c) => c.key === d.key);
    return (
      <div key={d.key} className={`lv-colpick-row${checked ? ' is-on' : ''}`}>
        <label className="lv-colpick-label">
          <input
            type="checkbox"
            checked={checked}
            onChange={() => toggle(d.key)}
          />
          <span className="lv-colpick-key">{d.label || d.key}</span>
          <span className="lv-colpick-meta">
            {d.origin === 'dynamic' && d.presenceRate !== undefined
              ? `${Math.round(d.presenceRate * 100)}%`
              : d.type}
          </span>
        </label>
        {checked && (
          <span className="lv-colpick-move">
            <button
              type="button"
              onClick={() => move(d.key, -1)}
              disabled={idx <= 0}
              title="Move left"
              aria-label="Move column left"
            >
              ←
            </button>
            <button
              type="button"
              onClick={() => move(d.key, 1)}
              disabled={idx < 0 || idx >= columns.length - 1}
              title="Move right"
              aria-label="Move column right"
            >
              →
            </button>
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="lv-colpick-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`lv-colpick-btn${open ? ' is-open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="Add or remove columns"
        aria-label="Columns"
      >
        + col
      </button>
      {open && (
        <div className="lv-colpick-pop" role="menu">
          {sortedDescriptors.logical.length > 0 && (
            <div className="lv-colpick-sec">
              <div className="lv-colpick-sec-title">Logical fields</div>
              {sortedDescriptors.logical.map(renderRow)}
            </div>
          )}
          {sortedDescriptors.dynamic.length > 0 && (
            <div className="lv-colpick-sec">
              <div className="lv-colpick-sec-title">Fields</div>
              {sortedDescriptors.dynamic.map(renderRow)}
            </div>
          )}
          <div className="lv-colpick-sec">
            <div className="lv-colpick-sec-title">Source / built-in</div>
            {sortedDescriptors.builtin.map(renderRow)}
          </div>
        </div>
      )}
    </div>
  );
};
