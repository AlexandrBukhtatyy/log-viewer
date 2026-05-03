import { useState } from 'react';
import type { LvFieldFilter, LvFieldFilterOp } from '../../contracts/lv-types.ts';

const SUGGESTED = ['status', 'user_id', 'service', 'trace_id', 'duration_ms', 'method', 'path', 'req_id', 'pod'];
const SYSTEM = ['$file', '$path', '$source', '$host', '$line', '$root', '$kind', '$ingested_at'];

const isSystem = (k: string): boolean => k.startsWith('$');

export interface LvAddFieldFilterProps {
  onAdd: (filter: LvFieldFilter) => void;
}

export const LvAddFieldFilter = ({ onAdd }: LvAddFieldFilterProps) => {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('status');
  const [op, setOp] = useState<LvFieldFilterOp>('=');
  const [value, setValue] = useState('500');

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
              className={`lv-field-input${isSystem(key) ? ' is-sys' : ''}`}
              placeholder="key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && commit()}
            />
            <datalist id="lv-field-keys">
              {SYSTEM.map((k) => (
                <option key={k} value={k} />
              ))}
              {SUGGESTED.map((k) => (
                <option key={k} value={k} />
              ))}
            </datalist>
            <select
              className="lv-field-op"
              value={op}
              onChange={(e) => setOp(e.target.value as LvFieldFilterOp)}
            >
              <option value="=">=</option>
              <option value="!=">≠</option>
              <option value=">">{'>'}</option>
              <option value="<">{'<'}</option>
              <option value="~">contains</option>
            </select>
            <input
              className="lv-field-input lv-field-val"
              placeholder="value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && commit()}
              autoFocus
            />
            <button type="button" className="lv-btn lv-btn-primary" onClick={commit}>
              Add
            </button>
            <button type="button" className="lv-btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
          <div className="lv-field-hints">
            <span className="lv-field-hints-lbl">System</span>
            {SYSTEM.slice(0, 6).map((k) => (
              <button
                type="button"
                key={k}
                className="lv-field-hint is-sys"
                onClick={() => setKey(k)}
              >
                {k}
              </button>
            ))}
            <span className="lv-field-hints-br" />
            <span className="lv-field-hints-lbl">Log</span>
            {SUGGESTED.slice(0, 6).map((k) => (
              <button type="button" key={k} className="lv-field-hint" onClick={() => setKey(k)}>
                {k}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
