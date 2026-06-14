import { useEffect, useState } from 'react';
import type {
  LogicalExtractor,
  LogicalField,
  LogicalFieldType,
  LogicalFieldsConfig,
} from '../../../core/types/index.ts';

const emptyFieldExtractor = (): LogicalExtractor => ({
  type: 'field',
  path: '',
});
const emptyRegexExtractor = (): LogicalExtractor => ({
  type: 'regex',
  on: 'message',
  pattern: '',
});
const emptyRegexOnJsonExtractor = (): LogicalExtractor => ({
  type: 'regex-on-json',
  path: '',
  pattern: '',
});

interface FormState {
  id: string;
  label: string;
  type: LogicalFieldType;
  description: string;
  extractors: LogicalExtractor[];
  error: string | null;
}

const emptyForm = (): FormState => ({
  id: '',
  label: '',
  type: 'string',
  description: '',
  extractors: [emptyFieldExtractor()],
  error: null,
});

const formFromField = (f: LogicalField): FormState => ({
  id: f.id,
  label: f.label,
  type: f.type,
  description: f.description ?? '',
  extractors: f.extractors.map((ex) => ({ ...ex })),
  error: null,
});

interface ExtractorRowProps {
  readonly extractor: LogicalExtractor;
  readonly index: number;
  readonly total: number;
  onChange(next: LogicalExtractor): void;
  onRemove(): void;
  onMove(dir: -1 | 1): void;
}

const ExtractorRow = ({
  extractor,
  index,
  total,
  onChange,
  onRemove,
  onMove,
}: ExtractorRowProps) => (
  <div
    className="lv-colpick-row is-on"
    style={{ flexDirection: 'column', alignItems: 'stretch', padding: 8, gap: 4 }}
  >
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <span className="lv-colpick-meta">#{index + 1}</span>
      <select
        value={extractor.type}
        onChange={(e) => {
          const next = e.target.value as LogicalExtractor['type'];
          if (next === 'field') onChange({ type: 'field', path: '' });
          else if (next === 'regex')
            onChange({ type: 'regex', on: 'message', pattern: '' });
          else onChange({ type: 'regex-on-json', path: '', pattern: '' });
        }}
      >
        <option value="field">field</option>
        <option value="regex">regex</option>
        <option value="regex-on-json">regex on JSON</option>
      </select>
      <span style={{ flex: 1 }} />
      <button
        type="button"
        onClick={() => onMove(-1)}
        disabled={index === 0}
        title="Move up"
      >
        ↑
      </button>
      <button
        type="button"
        onClick={() => onMove(1)}
        disabled={index === total - 1}
        title="Move down"
      >
        ↓
      </button>
      <button type="button" onClick={onRemove} title="Remove extractor">
        ✕
      </button>
    </div>
    {extractor.type === 'field' ? (
      <input
        type="text"
        value={extractor.path}
        onChange={(e) => onChange({ type: 'field', path: e.target.value })}
        placeholder="service.name"
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
      />
    ) : extractor.type === 'regex-on-json' ? (
      <>
        <input
          type="text"
          value={extractor.path}
          onChange={(e) => onChange({ ...extractor, path: e.target.value })}
          placeholder="source field path (e.g. context.message)"
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
        />
        <input
          type="text"
          value={extractor.pattern}
          onChange={(e) => onChange({ ...extractor, pattern: e.target.value })}
          placeholder="tr[ace]?[_-]?id=(?<v>\\w+)"
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
        />
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type="text"
            value={extractor.flags ?? ''}
            onChange={(e) => onChange({ ...extractor, flags: e.target.value })}
            placeholder="flags (i, …)"
            style={{ width: 90 }}
            spellCheck={false}
          />
          <input
            type="text"
            value={extractor.group ?? ''}
            onChange={(e) => onChange({ ...extractor, group: e.target.value })}
            placeholder="group (v)"
            style={{ flex: 1 }}
            spellCheck={false}
          />
        </div>
      </>
    ) : (
      <>
        <input
          type="text"
          value={extractor.pattern}
          onChange={(e) => onChange({ ...extractor, pattern: e.target.value })}
          placeholder="tr[ace]?[_-]?id=(?<v>\\w+)"
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
        />
        <div style={{ display: 'flex', gap: 6 }}>
          <select
            value={extractor.on}
            onChange={(e) =>
              onChange({
                ...extractor,
                on: e.target.value as 'message' | 'raw',
              })
            }
          >
            <option value="message">on: message</option>
            <option value="raw">on: raw</option>
          </select>
          <input
            type="text"
            value={extractor.flags ?? ''}
            onChange={(e) => onChange({ ...extractor, flags: e.target.value })}
            placeholder="flags (i, …)"
            style={{ width: 90 }}
            spellCheck={false}
          />
          <input
            type="text"
            value={extractor.group ?? ''}
            onChange={(e) => onChange({ ...extractor, group: e.target.value })}
            placeholder="group (v)"
            style={{ flex: 1 }}
            spellCheck={false}
          />
        </div>
      </>
    )}
  </div>
);

export interface LvLogicalFieldEditorModalProps {
  readonly open: boolean;
  readonly mode: 'new' | 'edit';
  /** Original field being edited — used to derive selfId and initial form state. */
  readonly initial?: LogicalField;
  readonly config: LogicalFieldsConfig;
  validate(
    field: LogicalField,
    config: LogicalFieldsConfig,
    selfId: string | null,
  ): string | null;
  onSave(field: LogicalField): void;
  onClose(): void;
}

export const LvLogicalFieldEditorModal = ({
  open,
  mode,
  initial,
  config,
  validate,
  onSave,
  onClose,
}: LvLogicalFieldEditorModalProps) => {
  const [form, setForm] = useState<FormState>(emptyForm);

  useEffect(() => {
    if (!open) return;
    setForm(
      mode === 'edit' && initial !== undefined
        ? formFromField(initial)
        : emptyForm(),
    );
  }, [open, mode, initial]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const patch = (over: Partial<FormState>): void =>
    setForm((f) => ({ ...f, ...over, error: null }));

  const updateExtractor = (idx: number, next: LogicalExtractor): void => {
    setForm((f) => {
      const list = f.extractors.slice();
      list[idx] = next;
      return { ...f, extractors: list, error: null };
    });
  };
  const removeExtractor = (idx: number): void => {
    setForm((f) => {
      const list = f.extractors.slice();
      list.splice(idx, 1);
      return { ...f, extractors: list, error: null };
    });
  };
  const moveExtractor = (idx: number, dir: -1 | 1): void => {
    setForm((f) => {
      const next = f.extractors.slice();
      const target = idx + dir;
      if (target < 0 || target >= next.length) return f;
      const tmp = next[idx]!;
      next[idx] = next[target]!;
      next[target] = tmp;
      return { ...f, extractors: next, error: null };
    });
  };

  const handleSave = (): void => {
    const candidate: LogicalField = {
      id: form.id.trim(),
      type: form.type,
      label: form.label.trim(),
      description: form.description.trim() || undefined,
      extractors: form.extractors,
      origin: 'user',
    };
    const selfId = mode === 'edit' && initial !== undefined ? initial.id : null;
    const err = validate(candidate, config, selfId);
    if (err !== null) {
      setForm((f) => ({ ...f, error: err }));
      return;
    }
    try {
      onSave(candidate);
    } catch (e) {
      setForm((f) => ({ ...f, error: (e as Error).message }));
      return;
    }
    onClose();
  };

  return (
    <>
      <div className="lv-modal-scrim" onClick={onClose} />
      <div
        className="lv-modal lv-logical-field-modal"
        role="dialog"
        aria-label={
          mode === 'edit' ? 'Edit logical field' : 'New logical field'
        }
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="lv-modal-hd">
          <span>
            {mode === 'edit' ? 'Edit logical field' : 'New logical field'}
          </span>
          <button
            type="button"
            className="lv-modal-x"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="lv-modal-body">
          <div className="lv-logical-field-form">
            <label className="lv-tset-vf-field">
              <span className="lv-tset-lbl">Id</span>
              <input
                type="text"
                value={form.id}
                onChange={(e) => patch({ id: e.target.value })}
                placeholder="audit_id"
                spellCheck={false}
                autoCapitalize="none"
                autoCorrect="off"
                disabled={mode === 'edit'}
              />
              <span className="lv-form-help">
                Lowercase identifier — appears in pickers as{' '}
                <code>~{form.id || 'name'}</code>.
              </span>
            </label>
            <label className="lv-tset-vf-field">
              <span className="lv-tset-lbl">Label</span>
              <input
                type="text"
                value={form.label}
                onChange={(e) => patch({ label: e.target.value })}
                placeholder="Audit id"
              />
            </label>
            <label className="lv-tset-vf-field">
              <span className="lv-tset-lbl">Type</span>
              <select
                value={form.type}
                onChange={(e) =>
                  patch({ type: e.target.value as LogicalFieldType })
                }
              >
                <option value="string">string</option>
                <option value="number">number</option>
                <option value="bool">bool</option>
              </select>
            </label>
            <label className="lv-tset-vf-field">
              <span className="lv-tset-lbl">Description (optional)</span>
              <input
                type="text"
                value={form.description}
                onChange={(e) => patch({ description: e.target.value })}
                placeholder="Per-action audit-trail id"
              />
            </label>

            <div className="lv-tset-vf-field">
              <span className="lv-tset-lbl">Extractors (first match wins)</span>
              {form.extractors.map((ex, idx) => (
                <ExtractorRow
                  key={idx}
                  extractor={ex}
                  index={idx}
                  total={form.extractors.length}
                  onChange={(next) => updateExtractor(idx, next)}
                  onRemove={() => removeExtractor(idx)}
                  onMove={(dir) => moveExtractor(idx, dir)}
                />
              ))}
              <div className="lv-tset-vf-add-row">
                <button
                  type="button"
                  onClick={() =>
                    patch({
                      extractors: [...form.extractors, emptyFieldExtractor()],
                    })
                  }
                >
                  + Field
                </button>
                <button
                  type="button"
                  onClick={() =>
                    patch({
                      extractors: [...form.extractors, emptyRegexExtractor()],
                    })
                  }
                >
                  + Regex
                </button>
                <button
                  type="button"
                  onClick={() =>
                    patch({
                      extractors: [
                        ...form.extractors,
                        emptyRegexOnJsonExtractor(),
                      ],
                    })
                  }
                >
                  + Regex on JSON
                </button>
              </div>
            </div>

            {form.error !== null && (
              <div className="lv-tset-vf-error" role="alert">
                {form.error}
              </div>
            )}
          </div>
        </div>
        <div className="lv-modal-ft lv-modal-ft-actions">
          <button type="button" className="lv-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="lv-btn lv-btn-primary"
            onClick={handleSave}
          >
            {mode === 'edit' ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </>
  );
};
