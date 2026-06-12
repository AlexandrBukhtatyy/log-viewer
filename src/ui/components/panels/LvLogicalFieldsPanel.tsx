import { useMemo, useState } from 'react';
import type {
  LogicalExtractor,
  LogicalField,
  LogicalFieldType,
  LogicalFieldsConfig,
} from '../../../core/types/index.ts';

const PREFIX = '~';

const extractorSummary = (field: LogicalField): string => {
  let fieldCount = 0;
  let regexCount = 0;
  for (const ex of field.extractors) {
    if (ex.type === 'field') fieldCount++;
    else regexCount++;
  }
  const parts: string[] = [];
  if (fieldCount > 0)
    parts.push(`${fieldCount} field${fieldCount === 1 ? '' : 's'}`);
  if (regexCount > 0) parts.push(`${regexCount} regex`);
  return parts.join(' + ') || 'no extractors';
};

interface RowProps {
  readonly field: LogicalField;
  readonly active: boolean;
  onToggle(id: string): void;
  onEdit?: (id: string) => void;
  onRemove?: (id: string) => void;
}

const Row = ({ field, active, onToggle, onEdit, onRemove }: RowProps) => (
  <div className={`lv-parsers-row${active ? ' is-active' : ''}`}>
    <div className="lv-parsers-row-main">
      <span className="lv-parsers-row-id">
        {PREFIX}
        {field.id}
      </span>
      <span className="lv-parsers-row-label">{field.label}</span>
      <span className="lv-parsers-row-kind">{extractorSummary(field)}</span>
      {field.description !== undefined && field.description.length > 0 && (
        <span
          className="lv-form-help"
          style={{ display: 'block', marginTop: 4 }}
        >
          {field.description}
        </span>
      )}
    </div>
    <div className="lv-parsers-row-act">
      <button
        type="button"
        className={`lv-btn ${active ? 'lv-btn-danger' : 'lv-btn-secondary'}`}
        onClick={() => onToggle(field.id)}
      >
        {active ? 'Deactivate' : 'Activate'}
      </button>
      {onEdit !== undefined && (
        <button
          type="button"
          className="lv-btn lv-btn-secondary"
          onClick={() => onEdit(field.id)}
        >
          Edit
        </button>
      )}
      {onRemove !== undefined && (
        <button
          type="button"
          className="lv-btn lv-btn-danger"
          onClick={() => onRemove(field.id)}
          title={`Delete ${PREFIX}${field.id}`}
        >
          Delete
        </button>
      )}
    </div>
  </div>
);

const emptyFieldExtractor = (): LogicalExtractor => ({
  type: 'field',
  path: '',
});
const emptyRegexExtractor = (): LogicalExtractor => ({
  type: 'regex',
  on: 'message',
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
  extractors: f.extractors.map((ex) =>
    ex.type === 'field'
      ? { ...ex }
      : { ...ex },
  ),
  error: null,
});

interface EditorProps {
  readonly form: FormState;
  readonly mode: 'new' | 'edit';
  onChange(next: FormState): void;
  onSave(): void;
  onCancel(): void;
}

const Editor = ({ form, mode, onChange, onSave, onCancel }: EditorProps) => {
  const patch = (over: Partial<FormState>): void =>
    onChange({ ...form, ...over, error: null });

  const updateExtractor = (
    idx: number,
    next: LogicalExtractor,
  ): void => {
    const list = form.extractors.slice();
    list[idx] = next;
    patch({ extractors: list });
  };
  const removeExtractor = (idx: number): void => {
    const list = form.extractors.slice();
    list.splice(idx, 1);
    patch({ extractors: list });
  };
  const moveExtractor = (idx: number, dir: -1 | 1): void => {
    const next = form.extractors.slice();
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    const tmp = next[idx]!;
    next[idx] = next[target]!;
    next[target] = tmp;
    patch({ extractors: next });
  };

  return (
    <div className="lv-tset-vf-form" style={{ padding: 12 }}>
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
        <div className="lv-tset-vf-actions">
          <button
            type="button"
            onClick={() =>
              patch({ extractors: [...form.extractors, emptyFieldExtractor()] })
            }
          >
            + Field extractor
          </button>
          <button
            type="button"
            onClick={() =>
              patch({ extractors: [...form.extractors, emptyRegexExtractor()] })
            }
          >
            + Regex extractor
          </button>
        </div>
      </div>

      {form.error !== null && (
        <div className="lv-tset-vf-error" role="alert">
          {form.error}
        </div>
      )}
      <div className="lv-tset-vf-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="lv-tset-vf-primary"
          onClick={onSave}
        >
          {mode === 'edit' ? 'Save' : 'Create'}
        </button>
      </div>
    </div>
  );
};

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
          onChange(
            next === 'field'
              ? { type: 'field', path: '' }
              : { type: 'regex', on: 'message', pattern: '' },
          );
        }}
      >
        <option value="field">field</option>
        <option value="regex">regex</option>
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
        onChange={(e) =>
          onChange({ type: 'field', path: e.target.value })
        }
        placeholder="service.name"
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
      />
    ) : (
      <>
        <input
          type="text"
          value={extractor.pattern}
          onChange={(e) =>
            onChange({ ...extractor, pattern: e.target.value })
          }
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
            onChange={(e) =>
              onChange({ ...extractor, flags: e.target.value })
            }
            placeholder="flags (i, …)"
            style={{ width: 90 }}
            spellCheck={false}
          />
          <input
            type="text"
            value={extractor.group ?? ''}
            onChange={(e) =>
              onChange({ ...extractor, group: e.target.value })
            }
            placeholder="group (v)"
            style={{ flex: 1 }}
            spellCheck={false}
          />
        </div>
      </>
    )}
  </div>
);

type EditState =
  | { mode: 'closed' }
  | { mode: 'new' }
  | { mode: 'edit'; id: string };

export interface LvLogicalFieldsPanelProps {
  /**
   * Full catalog of logical fields the user can choose from
   * (built-in templates + user-defined). The panel is dumb: order
   * within the array decides display order within each section.
   */
  readonly fields: ReadonlyArray<LogicalField>;
  /** Currently activated ids — toggles per-row UI state. */
  readonly activeIds: ReadonlyArray<string>;
  /**
   * Snapshot of the persisted config — used by inline validation to
   * detect id collisions without having to peek at `fields` (which
   * mixes built-ins and customs).
   */
  readonly config: LogicalFieldsConfig;
  onToggle(id: string): void;
  onAddCustom(field: LogicalField): void;
  onUpdateCustom(field: LogicalField): void;
  onRemoveCustom(id: string): void;
  /**
   * Validate a candidate field against the current config. Returns
   * a human-readable error or `null`. Injected so the panel stays
   * pure (no core imports) per ADR-0002.
   */
  validate(
    field: LogicalField,
    config: LogicalFieldsConfig,
    selfId: string | null,
  ): string | null;
}

/**
 * Settings panel for the `~`-namespace logical fields (ADR-0030).
 * Lists built-in templates + user-defined customs, lets the user
 * toggle activation, and provides an inline editor for creating /
 * editing customs.
 */
export const LvLogicalFieldsPanel = ({
  fields,
  activeIds,
  config,
  onToggle,
  onAddCustom,
  onUpdateCustom,
  onRemoveCustom,
  validate,
}: LvLogicalFieldsPanelProps) => {
  const [edit, setEdit] = useState<EditState>({ mode: 'closed' });
  const [form, setForm] = useState<FormState>(emptyForm);

  const activeSet = useMemo(() => new Set(activeIds), [activeIds]);
  const customIds = useMemo(
    () => new Set(config.customFields.map((f) => f.id)),
    [config.customFields],
  );

  const active = fields.filter((f) => activeSet.has(f.id));
  const inactive = fields.filter((f) => !activeSet.has(f.id));

  const startNew = (): void => {
    setForm(emptyForm());
    setEdit({ mode: 'new' });
  };
  const startEdit = (id: string): void => {
    const f = config.customFields.find((x) => x.id === id);
    if (f === undefined) return;
    setForm(formFromField(f));
    setEdit({ mode: 'edit', id });
  };
  const cancel = (): void => {
    setEdit({ mode: 'closed' });
    setForm(emptyForm());
  };
  const save = (): void => {
    const candidate: LogicalField = {
      id: form.id.trim(),
      type: form.type,
      label: form.label.trim(),
      description: form.description.trim() || undefined,
      extractors: form.extractors,
      origin: 'user',
    };
    const selfId = edit.mode === 'edit' ? edit.id : null;
    const err = validate(candidate, config, selfId);
    if (err !== null) {
      setForm({ ...form, error: err });
      return;
    }
    try {
      if (edit.mode === 'edit') onUpdateCustom(candidate);
      else onAddCustom(candidate);
    } catch (e) {
      setForm({ ...form, error: (e as Error).message });
      return;
    }
    cancel();
  };

  const isCustom = (id: string): boolean => customIds.has(id);

  return (
    <aside className="lv-sidebar lv-fields-panel">
      <div className="lv-sb-cta">
        <button
          type="button"
          className="lv-add-src-btn"
          onClick={startNew}
          disabled={edit.mode !== 'closed'}
          title="Create a custom logical field"
        >
          <span className="lv-add-src-plus" aria-hidden="true">＋</span>
          <span>New field</span>
        </button>
      </div>

      {edit.mode !== 'closed' && (
        <Editor
          form={form}
          mode={edit.mode}
          onChange={setForm}
          onSave={save}
          onCancel={cancel}
        />
      )}

      {active.length > 0 && (
        <div className="lv-parsers-section-hd">Active</div>
      )}
      <div className="lv-parsers-list">
        {active.map((f) => (
          <Row
            key={f.id}
            field={f}
            active
            onToggle={onToggle}
            onEdit={isCustom(f.id) ? startEdit : undefined}
            onRemove={isCustom(f.id) ? onRemoveCustom : undefined}
          />
        ))}
      </div>

      {inactive.length > 0 && (
        <div className="lv-parsers-section-hd">Catalog</div>
      )}
      <div className="lv-parsers-list">
        {inactive.map((f) => (
          <Row
            key={f.id}
            field={f}
            active={false}
            onToggle={onToggle}
            onEdit={isCustom(f.id) ? startEdit : undefined}
            onRemove={isCustom(f.id) ? onRemoveCustom : undefined}
          />
        ))}
      </div>

      {active.length === 0 && edit.mode === 'closed' && (
        <div className="lv-parsers-empty">
          Activate a template above or create your own to make it available in
          filter / group-by / column pickers across all tabs.
        </div>
      )}

      <div
        className="lv-form-help"
        style={{ padding: '8px 12px', marginTop: 8 }}
      >
        Field-type extractors work everywhere (column / filter / group-by).
        Regex-type extractors run only when rendering cells — server-side
        filter and group-by ignore them because the message / raw body is
        not stored in the index.
      </div>
    </aside>
  );
};
