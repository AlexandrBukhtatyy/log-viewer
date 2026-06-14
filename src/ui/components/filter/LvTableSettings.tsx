import { useEffect, useMemo, useRef, useState } from 'react';
import { Settings, X } from 'lucide-react';
import type { FieldDescriptor } from '../../../core/filter/field-descriptor.ts';
import type {
  LvColumnPref,
  LvGutterMode,
  LvTweakDensity,
  LvTweaks,
} from '../../contracts/lv-types.ts';
import { builtInColumn } from '../../contracts/lv-column-registry.tsx';
import { compatBadgeText, compatOf } from '../../utils/field-compatibility.ts';
import { isPresentInActiveSources } from '../../utils/field-presence.ts';

const DEFAULT_WIDTH_PX = 140;

export interface LvTableSettingsProps {
  readonly tweaks: LvTweaks;
  setTweak: <K extends keyof LvTweaks>(key: K, value: LvTweaks[K]) => void;
  readonly columns: ReadonlyArray<LvColumnPref>;
  readonly descriptors: ReadonlyArray<FieldDescriptor>;
  onColumnsChange: (next: ReadonlyArray<LvColumnPref>) => void;
  /** Used to compute compatibility badges (Phase 3). */
  readonly activeSources?: ReadonlyArray<{ id: string; name: string }>;
}

/**
 * Single gear button in the filter bar that opens a popover with all
 * table-level UI preferences: density, message wrap, date column, and
 * the column picker (reorder + toggle). Keeps the table header free of
 * controls and gives the user one obvious place for layout knobs.
 */
export const LvTableSettings = ({
  tweaks,
  setTweak,
  columns,
  descriptors,
  onColumnsChange,
  activeSources,
}: LvTableSettingsProps) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Phase 3 — preset form state.
  const [presetFormOpen, setPresetFormOpen] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [presetError, setPresetError] = useState<string | null>(null);
  const activeIds = useMemo(
    () => (activeSources ?? []).map((s) => s.id),
    [activeSources],
  );
  const sourceNameById = useMemo(
    () => new Map((activeSources ?? []).map((s) => [s.id, s.name])),
    [activeSources],
  );

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent): void => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selectedKeys = useMemo(
    () => new Set(columns.map((c) => c.key)),
    [columns],
  );

  // Dynamic descriptors are filtered down to the active sources so a
  // single-file tab doesn't list keys from other files (`bytes_sent`
  // on a pino tab, `$0` from a plain-text source, etc). Empty
  // `activeIds` is the "no source picked yet" path — show everything
  // so an empty selection isn't blank. Built-ins are universal.
  // Sorting: by presenceRate DESC; builtins follow in catalog order.
  const sortedDescriptors = useMemo(() => {
    const dyn = descriptors.filter((d) => d.origin === 'dynamic');
    const scoped =
      activeIds.length === 0
        ? dyn
        : dyn.filter((d) => isPresentInActiveSources(d, activeIds));
    const sorted = scoped.slice().sort((a, b) => {
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
    return { dynamic: sorted, builtin, logical };
  }, [descriptors, activeIds]);

  const toggle = (key: string): void => {
    if (selectedKeys.has(key)) {
      onColumnsChange(columns.filter((c) => c.key !== key));
    } else {
      const widthPx = builtInColumn(key)?.defaultWidthPx ?? DEFAULT_WIDTH_PX;
      onColumnsChange([...columns, { key, widthPx }]);
    }
  };

  const move = (key: string, dir: -1 | 1): void => {
    const idx = columns.findIndex((c) => c.key === key);
    if (idx < 0) return;
    const next = [...columns];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    const tmp = next[idx]!;
    next[idx] = next[swap]!;
    next[swap] = tmp;
    onColumnsChange(next);
  };

  const renderColRow = (d: FieldDescriptor) => {
    const checked = selectedKeys.has(d.key);
    const idx = columns.findIndex((c) => c.key === d.key);
    const compat = compatOf(d, activeIds);
    const compatLabel = compatBadgeText(compat, sourceNameById);
    return (
      <div key={d.key} className={`lv-colpick-row${checked ? ' is-on' : ''}`}>
        <label className="lv-colpick-label">
          <input
            type="checkbox"
            checked={checked}
            onChange={() => toggle(d.key)}
          />
          <span className="lv-colpick-key">{d.label || d.key}</span>
          {compatLabel !== null && (
            <span
              className={`lv-fld-compat lv-fld-compat-${compat.kind}`}
              title={
                compat.kind === 'unique'
                  ? `Only in ${compat.presentSources
                      .map((id) => sourceNameById.get(id) ?? id)
                      .join(', ')}`
                  : `Present in ${compat.presentIn} of ${compat.total} active sources`
              }
            >
              {compatLabel}
            </span>
          )}
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

  const setDensity = (d: LvTweakDensity): void => setTweak('density', d);
  const setGutter = (m: LvGutterMode): void => setTweak('gutterMode', m);

  // Phase 3 — preset handlers. Apply pushes columns into the active tab.
  const applyPreset = (id: string): void => {
    const p = tweaks.presets.find((x) => x.id === id);
    if (!p) return;
    onColumnsChange(p.columns);
  };
  const removePreset = (id: string): void => {
    setTweak(
      'presets',
      tweaks.presets.filter((p) => p.id !== id),
    );
  };
  const cancelPresetForm = (): void => {
    setPresetFormOpen(false);
    setPresetName('');
    setPresetError(null);
  };
  const savePreset = (): void => {
    setPresetError(null);
    const name = presetName.trim();
    if (name === '') {
      setPresetError('Preset name is empty.');
      return;
    }
    if (tweaks.presets.some((p) => p.name === name)) {
      setPresetError(`Preset "${name}" already exists.`);
      return;
    }
    setTweak('presets', [
      ...tweaks.presets,
      {
        id: `user:${Date.now()}`,
        name,
        columns,
        origin: 'user',
      },
    ]);
    cancelPresetForm();
  };

  return (
    <div className="lv-tset-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`lv-btn lv-tset-btn${open ? ' is-on' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="Table settings"
        aria-label="Table settings"
      >
        <Settings size={14} strokeWidth={1.5} aria-hidden="true" />
      </button>
      {open && (
        <div className="lv-tset-pop" role="menu">
          <div className="lv-tset-sec">
            <div className="lv-tset-sec-title">Display</div>
            <div className="lv-tset-row">
              <span className="lv-tset-lbl">Density</span>
              <div className="lv-tset-segs">
                <button
                  type="button"
                  className={`lv-tset-seg${tweaks.density === 'compact' ? ' is-on' : ''}`}
                  onClick={() => setDensity('compact')}
                >
                  Compact
                </button>
                <button
                  type="button"
                  className={`lv-tset-seg${tweaks.density === 'comfortable' ? ' is-on' : ''}`}
                  onClick={() => setDensity('comfortable')}
                >
                  Comfortable
                </button>
              </div>
            </div>
            <label className="lv-tset-toggle">
              <input
                type="checkbox"
                checked={tweaks.showDate}
                onChange={(e) => setTweak('showDate', e.target.checked)}
              />
              <span>Show date in timestamp</span>
            </label>
            <div className="lv-tset-row">
              <span className="lv-tset-lbl">Gutter shows</span>
              <div className="lv-tset-segs">
                <button
                  type="button"
                  className={`lv-tset-seg${tweaks.gutterMode === 'line' ? ' is-on' : ''}`}
                  onClick={() => setGutter('line')}
                  title="Physical line number in the source file"
                >
                  Line
                </button>
                <button
                  type="button"
                  className={`lv-tset-seg${tweaks.gutterMode === 'entry' ? ' is-on' : ''}`}
                  onClick={() => setGutter('entry')}
                  title="Per-file log-record ordinal"
                >
                  Entry
                </button>
                <button
                  type="button"
                  className={`lv-tset-seg${tweaks.gutterMode === 'both' ? ' is-on' : ''}`}
                  onClick={() => setGutter('both')}
                  title="Line · Entry"
                >
                  Both
                </button>
              </div>
            </div>
          </div>
          <div className="lv-tset-sep" role="separator" />
          <div className="lv-tset-sec">
            <div className="lv-tset-sec-title">Presets</div>
            {tweaks.presets.length === 0 && !presetFormOpen && (
              <div className="lv-tset-hint">
                Save the current columns as a named preset to apply on other
                tabs.
              </div>
            )}
            {tweaks.presets.map((p) => (
              <div key={p.id} className="lv-colpick-row">
                <button
                  type="button"
                  className="lv-tset-preset-apply"
                  onClick={() => applyPreset(p.id)}
                  title={`Apply preset: ${p.columns.length} columns`}
                >
                  {p.name}
                </button>
                {p.origin === 'user' && (
                  <span className="lv-colpick-move">
                    <button
                      type="button"
                      onClick={() => removePreset(p.id)}
                      title="Delete preset"
                      aria-label={`Delete preset ${p.name}`}
                    >
                      <X size={12} strokeWidth={1.5} aria-hidden="true" />
                    </button>
                  </span>
                )}
              </div>
            ))}
            {presetFormOpen ? (
              <div className="lv-tset-vf-form">
                <label className="lv-tset-vf-field">
                  <span className="lv-tset-lbl">Preset name</span>
                  <input
                    type="text"
                    value={presetName}
                    onChange={(e) => setPresetName(e.target.value)}
                    placeholder="My pino columns"
                    autoFocus
                  />
                </label>
                {presetError !== null && (
                  <div className="lv-tset-vf-error" role="alert">
                    {presetError}
                  </div>
                )}
                <div className="lv-tset-vf-actions">
                  <button type="button" onClick={cancelPresetForm}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="lv-tset-vf-primary"
                    onClick={savePreset}
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="lv-tset-vf-add"
                onClick={() => setPresetFormOpen(true)}
                disabled={columns.length === 0}
                title={
                  columns.length === 0
                    ? 'Configure columns before saving as preset'
                    : undefined
                }
              >
                + Save current as preset
              </button>
            )}
          </div>
          <div className="lv-tset-sep" role="separator" />
          <div className="lv-tset-sec">
            <div className="lv-tset-sec-title">Columns</div>
            {sortedDescriptors.logical.length > 0 && (
              <>
                <div className="lv-tset-sub">Logical fields</div>
                {sortedDescriptors.logical.map(renderColRow)}
              </>
            )}
            {sortedDescriptors.dynamic.length > 0 && (
              <>
                <div className="lv-tset-sub">Fields</div>
                {sortedDescriptors.dynamic.map(renderColRow)}
              </>
            )}
            <div className="lv-tset-sub">Source / built-in</div>
            {sortedDescriptors.builtin.map(renderColRow)}
          </div>
        </div>
      )}
    </div>
  );
};
