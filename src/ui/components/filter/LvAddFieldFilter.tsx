import { useMemo, useState } from 'react';
import type { FieldDescriptor } from '../../../core/filter/field-descriptor.ts';
import type { FieldFilter, FieldFilterOp } from '../../../core/types/index.ts';
import { compatBadgeText, compatOf } from '../../utils/field-compatibility.ts';

export interface LvAddFieldFilterProps {
  readonly descriptors: ReadonlyArray<FieldDescriptor>;
  onAdd: (filter: FieldFilter) => void;
  /** Used to compute compatibility badges (Phase 3). */
  readonly activeSources?: ReadonlyArray<{ id: string; name: string }>;
}

const isBuiltIn = (key: string): boolean => key.startsWith('@');

/**
 * "+ field" filter builder (ADR-0017 Phase 7). The key combobox is
 * fed by `coordinator.getFieldSchema` — built-ins (`@ts`, `@level`,
 * `@source.kind`, …) and dynamic JSON keys mix in one autocomplete
 * datalist. The value input pulls suggestions from `topValues` of
 * the currently selected descriptor.
 */
export const LvAddFieldFilter = ({ descriptors, onAdd, activeSources }: LvAddFieldFilterProps) => {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState<string>('');
  const [op, setOp] = useState<FieldFilterOp>('=');
  const [value, setValue] = useState('');
  const activeIds = useMemo(
    () => (activeSources ?? []).map((s) => s.id),
    [activeSources],
  );
  const sourceNameById = useMemo(
    () => new Map((activeSources ?? []).map((s) => [s.id, s.name])),
    [activeSources],
  );

  const sortedDescriptors = useMemo(() => {
    const dyn = descriptors.filter((d) => d.origin === 'dynamic').slice();
    dyn.sort((a, b) => {
      const aRate = a.presenceRate ?? 0;
      const bRate = b.presenceRate ?? 0;
      if (aRate !== bRate) return bRate - aRate;
      return a.key.localeCompare(b.key);
    });
    return {
      dynamic: dyn,
      builtin: descriptors.filter((d) => d.origin === 'builtin'),
      logical: descriptors.filter((d) => d.origin === 'logical'),
    };
  }, [descriptors]);

  const selected = useMemo(
    () => descriptors.find((d) => d.key === key) ?? null,
    [descriptors, key],
  );

  const commit = () => {
    if (!key || !value) return;
    onAdd({ key: key.trim(), op, value: value.trim() });
    setOpen(false);
    setValue('');
  };

  return (
    <div className="lv-field-add">
      <button
        type="button"
        className={`lv-chip-add${open ? ' is-active' : ''}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span>＋ field</span>
      </button>
      {open && (
        <div className="lv-field-pop">
          <div className="lv-field-pop-row">
            <input
              list="lv-field-keys"
              className={`lv-field-input${isBuiltIn(key) ? ' is-sys' : ''}`}
              placeholder="field key (@ts, trace_id, …)"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && commit()}
            />
            <datalist id="lv-field-keys">
              {sortedDescriptors.builtin.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label}
                </option>
              ))}
              {sortedDescriptors.logical.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label}
                </option>
              ))}
              {sortedDescriptors.dynamic.map((d) => (
                <option key={d.key} value={d.key} />
              ))}
            </datalist>
            <select
              className="lv-field-op"
              value={op}
              onChange={(e) => setOp(e.target.value as FieldFilterOp)}
            >
              <option value="=">=</option>
              <option value="!=">≠</option>
              <option value=">">{'>'}</option>
              <option value="<">{'<'}</option>
              <option value="~">contains</option>
            </select>
            <input
              list={selected?.topValues && selected.topValues.length > 0 ? 'lv-field-vals' : undefined}
              className="lv-field-input lv-field-val"
              placeholder="value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && commit()}
              autoFocus
            />
            {selected?.topValues && selected.topValues.length > 0 && (
              <datalist id="lv-field-vals">
                {selected.topValues.map((tv) => (
                  <option key={tv.value} value={tv.value}>
                    {tv.count}
                  </option>
                ))}
              </datalist>
            )}
            <button type="button" className="lv-btn lv-btn-primary" onClick={commit}>
              Add
            </button>
            <button type="button" className="lv-btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
          <div className="lv-field-hints">
            {sortedDescriptors.builtin.length > 0 && (
              <>
                <span className="lv-field-hints-lbl">Built-in</span>
                {sortedDescriptors.builtin.slice(0, 6).map((d) => (
                  <button
                    type="button"
                    key={d.key}
                    className="lv-field-hint is-sys"
                    onClick={() => setKey(d.key)}
                  >
                    {d.key}
                  </button>
                ))}
                <span className="lv-field-hints-br" />
              </>
            )}
            {sortedDescriptors.dynamic.length > 0 && (
              <>
                <span className="lv-field-hints-lbl">Fields</span>
                {sortedDescriptors.dynamic.slice(0, 6).map((d) => {
                  const c = compatOf(d, activeIds);
                  const txt = compatBadgeText(c, sourceNameById);
                  return (
                    <button
                      type="button"
                      key={d.key}
                      className="lv-field-hint"
                      onClick={() => setKey(d.key)}
                    >
                      {d.key}
                      {txt !== null && (
                        <span
                          className={`lv-fld-compat lv-fld-compat-${c.kind}`}
                          title={
                            c.kind === 'unique'
                              ? `Only in ${c.presentSources
                                  .map((id) => sourceNameById.get(id) ?? id)
                                  .join(', ')}`
                              : `Present in ${c.presentIn} of ${c.total} active sources`
                          }
                        >
                          {txt}
                        </span>
                      )}
                    </button>
                  );
                })}
              </>
            )}
            {sortedDescriptors.dynamic.length === 0 && sortedDescriptors.builtin.length === 0 && (
              <span className="lv-field-hints-lbl">No fields yet — pick a source.</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
