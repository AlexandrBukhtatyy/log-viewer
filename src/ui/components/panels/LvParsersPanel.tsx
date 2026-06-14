import { useState } from 'react';
import type { LogLevel } from '../../../core/types/index.ts';
import {
  compileGrok,
  PARSER_TEMPLATES,
  type CustomParserDef,
  type CustomParserField,
  type CustomParserKind,
} from '../../utils/parser-form.ts';
import { LvFormField } from '../common/LvFormField.tsx';

export interface LvParsersPanelProps {
  readonly parsers: ReadonlyArray<CustomParserDef>;
  /** Save (insert or update) a parser. Re-registration is handled coordinator-side. */
  onUpsert: (def: CustomParserDef) => Promise<void> | void;
  /** Delete by id. */
  onRemove: (id: string) => Promise<void> | void;
}

type EditState =
  | { mode: 'closed' }
  | { mode: 'new' }
  | { mode: 'edit'; id: string };

const LEVELS: ReadonlyArray<LogLevel> = [
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
];

const TRANSFORMS = [
  'as-is',
  'number',
  'apache-time',
  'iso-time',
  'epoch-ms',
  'syslog-time',
] as const;

/** Rough id sanitisation — keeps the id usable as a registry key and in source.parserId. */
const slugify = (raw: string): string =>
  raw.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-');

/** Form state: easier to manipulate when fields/timestamp/level live as strings on the edit form. */
interface FormState {
  id: string;
  label: string;
  kind: CustomParserKind;
  pattern: string;
  flags: string;
  fieldsJson: string; // JSON array of CustomParserField (regex mode)
  customTokensJson: string; // JSON object {NAME: pattern} (grok mode)
  timestampGroup: string;
  timestampField: string;
  timestampTransform: string;
  levelStrategy: string;
  levelGroup: string;
  levelField: string;
  levelFixed: LogLevel;
  messageTemplate: string;
  defaultColumns: string; // comma-separated
  error: string | null;
}

const defaultFields: ReadonlyArray<CustomParserField> = [];

const emptyForm = (): FormState => ({
  id: '',
  label: '',
  kind: 'regex',
  pattern: '',
  flags: '',
  fieldsJson: JSON.stringify(defaultFields, null, 2),
  customTokensJson: '{}',
  timestampGroup: '',
  timestampField: '',
  timestampTransform: 'iso-time',
  levelStrategy: '',
  levelGroup: '',
  levelField: '',
  levelFixed: 'info',
  messageTemplate: '',
  defaultColumns: '',
  error: null,
});

const formFromDef = (def: CustomParserDef): FormState => ({
  id: def.id,
  label: def.label,
  kind: def.kind,
  pattern: def.pattern,
  flags: def.flags,
  fieldsJson: JSON.stringify(def.fields, null, 2),
  customTokensJson: JSON.stringify(def.customTokens ?? {}, null, 2),
  timestampGroup: def.timestampGroup?.toString() ?? '',
  timestampField: def.timestampField ?? '',
  timestampTransform: def.timestampTransform ?? 'iso-time',
  levelStrategy: def.levelStrategy ?? '',
  levelGroup: def.levelGroup?.toString() ?? '',
  levelField: def.levelField ?? '',
  levelFixed: def.levelFixed ?? 'info',
  messageTemplate: def.messageTemplate ?? '',
  defaultColumns: (def.defaultColumns ?? []).join(', '),
  error: null,
});

const buildDef = (
  form: FormState,
  prior: CustomParserDef | null,
): { def?: CustomParserDef; error?: string } => {
  const id = slugify(form.id);
  if (!id) return { error: 'Parser id is required.' };
  if (!form.pattern.trim()) return { error: 'Pattern is required.' };
  const now = Date.now();
  if (form.kind === 'regex') {
    let fields: CustomParserField[];
    try {
      const parsed = JSON.parse(form.fieldsJson);
      if (!Array.isArray(parsed)) throw new Error('fields must be an array');
      fields = parsed.map((f, i) => {
        if (
          typeof f !== 'object' ||
          f === null ||
          typeof f.group !== 'number' ||
          typeof f.name !== 'string'
        ) {
          throw new Error(`fields[${i}] needs { group: number, name: string }`);
        }
        return {
          group: f.group,
          name: f.name,
          transform: f.transform,
        };
      });
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
    // Sanity-check the regex up front — same constructor the worker
    // will run, so we catch syntactic problems before the round-trip.
    try {
      new RegExp(form.pattern, form.flags || '');
    } catch (err) {
      return {
        error: `Invalid regex: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    const def: CustomParserDef = {
      id,
      label: form.label.trim() || id,
      kind: 'regex',
      pattern: form.pattern,
      flags: form.flags,
      fields,
      timestampGroup: form.timestampGroup
        ? Number(form.timestampGroup)
        : undefined,
      timestampTransform: form.timestampGroup
        ? (form.timestampTransform as CustomParserDef['timestampTransform'])
        : undefined,
      levelStrategy: form.levelStrategy
        ? (form.levelStrategy as CustomParserDef['levelStrategy'])
        : undefined,
      levelGroup:
        form.levelStrategy && form.levelStrategy !== 'fixed' && form.levelGroup
          ? Number(form.levelGroup)
          : undefined,
      levelFixed: form.levelStrategy === 'fixed' ? form.levelFixed : undefined,
      messageTemplate: form.messageTemplate.trim() || undefined,
      defaultColumns: form.defaultColumns
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      version: (prior?.version ?? 0) + 1,
      createdAt: prior?.createdAt ?? now,
      updatedAt: now,
    };
    return { def };
  }
  if (form.kind === 'js-function') {
    // Compile-test in the main thread first — same `new Function`
    // constructor the worker will use. A syntax error surfaces in the
    // form instead of the worker console.
    try {
      new Function('line', 'ctx', form.pattern);
    } catch (err) {
      return {
        error: `Invalid JS: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    const def: CustomParserDef = {
      id,
      label: form.label.trim() || id,
      kind: 'js-function',
      pattern: form.pattern,
      flags: '',
      fields: [],
      messageTemplate: undefined,
      defaultColumns: form.defaultColumns
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      version: (prior?.version ?? 0) + 1,
      createdAt: prior?.createdAt ?? now,
      updatedAt: now,
    };
    return { def };
  }
  // ---- grok ----
  const customTokens: Record<string, string> = {};
  if (form.customTokensJson.trim()) {
    try {
      const parsed = JSON.parse(form.customTokensJson);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('customTokens must be a JSON object');
      }
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v !== 'string') {
          throw new Error(`customTokens.${k} must be a string`);
        }
        customTokens[k] = v;
      }
    } catch (err) {
      return {
        error: `Invalid custom tokens JSON: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
  // Pre-flight compile so the user sees grok errors here instead of
  // after the worker round-trip.
  try {
    compileGrok(form.pattern, customTokens);
  } catch (err) {
    return {
      error: `Invalid grok: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const def: CustomParserDef = {
    id,
    label: form.label.trim() || id,
    kind: 'grok',
    pattern: form.pattern,
    flags: '',
    fields: [],
    customTokens: Object.keys(customTokens).length > 0 ? customTokens : undefined,
    timestampField: form.timestampField.trim() || undefined,
    timestampTransform: form.timestampField.trim()
      ? (form.timestampTransform as CustomParserDef['timestampTransform'])
      : undefined,
    levelStrategy: form.levelStrategy
      ? (form.levelStrategy as CustomParserDef['levelStrategy'])
      : undefined,
    levelField:
      form.levelStrategy && form.levelStrategy !== 'fixed' && form.levelField
        ? form.levelField.trim()
        : undefined,
    levelFixed: form.levelStrategy === 'fixed' ? form.levelFixed : undefined,
    messageTemplate: form.messageTemplate.trim() || undefined,
    defaultColumns: form.defaultColumns
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    version: (prior?.version ?? 0) + 1,
    createdAt: prior?.createdAt ?? now,
    updatedAt: now,
  };
  return { def };
};

const JS_PARSERS_FLAG_KEY = 'lv:jsParsersEnabled';
const readJsEnabled = (): boolean => {
  try {
    return localStorage.getItem(JS_PARSERS_FLAG_KEY) === '1';
  } catch {
    return false;
  }
};
const writeJsEnabled = (v: boolean): void => {
  try {
    localStorage.setItem(JS_PARSERS_FLAG_KEY, v ? '1' : '0');
  } catch {
    /* localStorage might be disabled — just lose the preference */
  }
};

export const LvParsersPanel = ({
  parsers,
  onUpsert,
  onRemove,
}: LvParsersPanelProps) => {
  const [edit, setEdit] = useState<EditState>({ mode: 'closed' });
  const [form, setForm] = useState<FormState>(emptyForm);
  const [jsEnabled, setJsEnabled] = useState<boolean>(readJsEnabled);

  const startNew = (): void => {
    setForm(emptyForm());
    setEdit({ mode: 'new' });
  };

  const startEdit = (def: CustomParserDef): void => {
    setForm(formFromDef(def));
    setEdit({ mode: 'edit', id: def.id });
  };

  const cancel = (): void => {
    setEdit({ mode: 'closed' });
    setForm(emptyForm());
  };

  const save = async (): Promise<void> => {
    const prior =
      edit.mode === 'edit' ? (parsers.find((p) => p.id === edit.id) ?? null) : null;
    const { def, error } = buildDef(form, prior);
    if (def === undefined || error) {
      setForm({ ...form, error: error ?? 'unknown error' });
      return;
    }
    await onUpsert(def);
    cancel();
  };

  const updateField = <K extends keyof FormState>(key: K, value: FormState[K]): void =>
    setForm({ ...form, [key]: value, error: null });

  return (
    <aside className="lv-sidebar lv-parsers-panel">
      <div className="lv-sb-cta">
        <button
          type="button"
          className="lv-add-src-btn"
          onClick={startNew}
          title="Create a new custom parser"
        >
          <span className="lv-add-src-plus" aria-hidden="true">＋</span>
          <span>New parser</span>
        </button>
      </div>

      <label className="lv-parsers-js-toggle" title="JS parsers run with full worker permissions — only enable for code you've reviewed.">
        <input
          type="checkbox"
          checked={jsEnabled}
          onChange={(e) => {
            const next = e.target.checked;
            setJsEnabled(next);
            writeJsEnabled(next);
            // When the user toggles JS off mid-edit and the form is on
            // js-function, fall back to regex so the form stays usable.
            if (!next && form.kind === 'js-function') {
              setForm({ ...form, kind: 'regex', error: null });
            }
          }}
        />
        <span>Enable JS parsers</span>
        <span className="lv-form-help">code runs in the parser worker</span>
      </label>

      {parsers.length === 0 && edit.mode === 'closed' && (
        <div className="lv-parsers-empty">
          No custom parsers yet. Click <strong>+ New parser</strong> to add one.
        </div>
      )}

      {parsers.length > 0 && (
        <div className="lv-parsers-section-hd">Yours</div>
      )}
      <div className="lv-parsers-list">
        {parsers.map((p) => (
          <div key={p.id} className="lv-parsers-row">
            <div className="lv-parsers-row-main">
              <span className="lv-parsers-row-id">{p.id}</span>
              <span className="lv-parsers-row-label">{p.label}</span>
              <span className="lv-parsers-row-kind">{p.kind}</span>
            </div>
            <div className="lv-parsers-row-act">
              <button
                type="button"
                className="lv-btn lv-btn-secondary"
                onClick={() => startEdit(p)}
              >
                Edit
              </button>
              <button
                type="button"
                className="lv-btn lv-btn-danger"
                onClick={() => void onRemove(p.id)}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {PARSER_TEMPLATES.length > 0 && (
        <>
          <div className="lv-parsers-section-hd">Templates</div>
          <div className="lv-parsers-list">
            {PARSER_TEMPLATES.map((t) => {
              const installed = parsers.some((p) => p.id === t.id);
              return (
                <div key={t.id} className="lv-parsers-row">
                  <div className="lv-parsers-row-main">
                    <span className="lv-parsers-row-id">{t.id}</span>
                    <span className="lv-parsers-row-label">{t.label}</span>
                    <span className="lv-parsers-row-kind">{t.kind}</span>
                  </div>
                  <div className="lv-parsers-row-act">
                    <button
                      type="button"
                      className="lv-btn lv-btn-secondary"
                      onClick={() => {
                        const now = Date.now();
                        void onUpsert({
                          ...t,
                          version: 1,
                          createdAt: now,
                          updatedAt: now,
                        });
                      }}
                      title={
                        installed
                          ? 'Re-import overwrites your current copy with the template defaults'
                          : 'Copy this template into your workspace'
                      }
                    >
                      {installed ? 'Re-import' : 'Import'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {edit.mode !== 'closed' && (
        <div className="lv-parsers-form">
          <div className="lv-parsers-form-hd">
            {edit.mode === 'new' ? 'New parser' : `Edit “${edit.id}”`}
          </div>

          <div className="lv-form-row lv-parsers-row-pair">
            <label className="lv-form-half">
              <span className="lv-form-label">Id</span>
              <input
                className="lv-form-input"
                type="text"
                value={form.id}
                placeholder="my-app-log"
                onChange={(e) => updateField('id', e.target.value)}
                disabled={edit.mode === 'edit'}
              />
            </label>
            <label className="lv-form-half">
              <span className="lv-form-label">Kind</span>
              <select
                className="lv-form-input"
                value={form.kind}
                onChange={(e) =>
                  updateField('kind', e.target.value as CustomParserKind)
                }
                disabled={edit.mode === 'edit'}
              >
                <option value="regex">regex</option>
                <option value="grok">grok</option>
                {(jsEnabled || form.kind === 'js-function') && (
                  <option value="js-function">js-function</option>
                )}
              </select>
            </label>
          </div>
          <LvFormField orientation="column" label="Label" htmlFor="lv-parser-label">
            <input
              id="lv-parser-label"
              className="lv-form-input"
              type="text"
              value={form.label}
              placeholder="Human-readable name"
              onChange={(e) => updateField('label', e.target.value)}
            />
          </LvFormField>
          <LvFormField
            orientation="column"
            htmlFor="lv-parser-pattern"
            label={
              form.kind === 'grok'
                ? 'Grok pattern'
                : form.kind === 'js-function'
                  ? 'JS function body'
                  : 'Regex pattern'
            }
            help={
              form.kind === 'grok' ? (
                <>
                  Use <code>%&#123;TOKEN:name&#125;</code> to capture, optional
                  <code>:int</code>/<code>:float</code> coerces to number.
                  Common tokens: IP, IPORHOST, NUMBER, INT, WORD, URIPATHPARAM,
                  QUOTEDSTRING, TIMESTAMP_ISO8601, HTTPDATE, SYSLOGTIMESTAMP,
                  LOGLEVEL, DATA, GREEDYDATA.
                </>
              ) : form.kind === 'js-function' ? (
                <>
                  Body of <code>(line, ctx) =&gt; …</code>. Return{' '}
                  <code>null</code> to skip the line. Code runs inside the
                  parser worker — no DOM, full <code>fetch</code>. Errors
                  per-line are swallowed; syntax errors block the parser.
                </>
              ) : undefined
            }
          >
            <textarea
              id="lv-parser-pattern"
              className="lv-form-input lv-parsers-pattern"
              rows={form.kind === 'js-function' ? 10 : 3}
              value={form.pattern}
              placeholder={
                form.kind === 'grok'
                  ? '%{IPORHOST:client} - %{USER:user} \\[%{HTTPDATE:@ts}\\] "%{WORD:method} %{URIPATHPARAM:uri} HTTP/%{NUMBER:http_version}" %{NUMBER:status:int} %{NUMBER:bytes:int}'
                  : form.kind === 'js-function'
                    ? '// (line: string, ctx) => ({ timestamp?, level?, message?, fields? }) | null\nconst m = line.match(/^\\[(\\w+)\\] (.+)$/);\nif (!m) return null;\nreturn { level: m[1], message: m[2], fields: {} };'
                    : '^\\[(\\S+)\\] (\\w+) (.+)$'
              }
              onChange={(e) => updateField('pattern', e.target.value)}
            />
          </LvFormField>
          {form.kind === 'regex' && (
            <>
              <LvFormField orientation="column" label="Flags" htmlFor="lv-parser-flags">
                <input
                  id="lv-parser-flags"
                  className="lv-form-input"
                  type="text"
                  value={form.flags}
                  placeholder="i, m, s, …"
                  onChange={(e) => updateField('flags', e.target.value)}
                />
              </LvFormField>
              <LvFormField
                orientation="column"
                label="Fields (JSON)"
                htmlFor="lv-parser-fields"
                help={<>Available transforms: {TRANSFORMS.join(', ')}.</>}
              >
                <textarea
                  id="lv-parser-fields"
                  className="lv-form-input lv-parsers-fields"
                  rows={6}
                  value={form.fieldsJson}
                  placeholder='[{"group":1,"name":"service"}, {"group":2,"name":"status","transform":"number"}]'
                  onChange={(e) => updateField('fieldsJson', e.target.value)}
                />
              </LvFormField>
            </>
          )}
          {form.kind === 'grok' && (
            <LvFormField
              orientation="column"
              label="Custom tokens (JSON)"
              htmlFor="lv-parser-tokens"
              help={
                <>
                  Optional map of additional <code>%&#123;NAME&#125;</code> tokens
                  — each value is itself a grok source.
                </>
              }
            >
              <textarea
                id="lv-parser-tokens"
                className="lv-form-input lv-parsers-fields"
                rows={3}
                value={form.customTokensJson}
                placeholder='{"MYID": "[A-Z]{3}-%{NUMBER}"}'
                onChange={(e) => updateField('customTokensJson', e.target.value)}
              />
            </LvFormField>
          )}
          {form.kind !== 'js-function' && (
            <>
              <div className="lv-form-row lv-parsers-row-pair">
                <label className="lv-form-half">
                  <span className="lv-form-label">
                    {form.kind === 'grok' ? 'Timestamp field' : 'Timestamp group'}
                  </span>
                  <input
                    className="lv-form-input"
                    type="text"
                    value={
                      form.kind === 'grok' ? form.timestampField : form.timestampGroup
                    }
                    placeholder={
                      form.kind === 'grok' ? '(field name, e.g. @ts)' : '(group # or empty)'
                    }
                    onChange={(e) =>
                      form.kind === 'grok'
                        ? updateField('timestampField', e.target.value)
                        : updateField('timestampGroup', e.target.value)
                    }
                  />
                </label>
                <label className="lv-form-half">
                  <span className="lv-form-label">Timestamp transform</span>
                  <select
                    className="lv-form-input"
                    value={form.timestampTransform}
                    onChange={(e) =>
                      updateField('timestampTransform', e.target.value)
                    }
                  >
                    {TRANSFORMS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="lv-form-row lv-parsers-row-pair">
                <label className="lv-form-half">
                  <span className="lv-form-label">Level strategy</span>
                  <select
                    className="lv-form-input"
                    value={form.levelStrategy}
                    onChange={(e) => updateField('levelStrategy', e.target.value)}
                  >
                    <option value="">(unknown)</option>
                    <option value="fixed">fixed</option>
                    <option value="group-name">group-name</option>
                    <option value="http-status">http-status</option>
                    <option value="syslog-severity">syslog-severity</option>
                  </select>
                </label>
                {form.levelStrategy === 'fixed' ? (
                  <label className="lv-form-half">
                    <span className="lv-form-label">Level (fixed)</span>
                    <select
                      className="lv-form-input"
                      value={form.levelFixed}
                      onChange={(e) =>
                        updateField('levelFixed', e.target.value as LogLevel)
                      }
                    >
                      {LEVELS.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : form.levelStrategy ? (
                  <label className="lv-form-half">
                    <span className="lv-form-label">
                      {form.kind === 'grok' ? 'Level field' : 'Level group #'}
                    </span>
                    <input
                      className="lv-form-input"
                      type="text"
                      value={form.kind === 'grok' ? form.levelField : form.levelGroup}
                      placeholder={form.kind === 'grok' ? '(field name)' : '(group #)'}
                      onChange={(e) =>
                        form.kind === 'grok'
                          ? updateField('levelField', e.target.value)
                          : updateField('levelGroup', e.target.value)
                      }
                    />
                  </label>
                ) : (
                  <span className="lv-form-half" />
                )}
              </div>
              <LvFormField orientation="column" label="Message template" htmlFor="lv-parser-msg">
                <input
                  id="lv-parser-msg"
                  className="lv-form-input"
                  type="text"
                  value={form.messageTemplate}
                  placeholder={
                    form.kind === 'grok'
                      ? '${method} ${uri} → ${status}'
                      : '${2} ${3} (use ${n} for group n)'
                  }
                  onChange={(e) => updateField('messageTemplate', e.target.value)}
                />
              </LvFormField>
            </>
          )}
          <LvFormField
            orientation="column"
            label="Default columns"
            htmlFor="lv-parser-cols"
            help={<>Comma-separated field names.</>}
          >
            <input
              id="lv-parser-cols"
              className="lv-form-input"
              type="text"
              value={form.defaultColumns}
              placeholder="status, request_uri"
              onChange={(e) => updateField('defaultColumns', e.target.value)}
            />
          </LvFormField>

          {form.error && (
            <div className="lv-form-error">{form.error}</div>
          )}

          <div className="lv-parsers-form-ft">
            <button
              type="button"
              className="lv-btn lv-btn-secondary"
              onClick={cancel}
            >
              Cancel
            </button>
            <button
              type="button"
              className="lv-btn lv-btn-primary"
              onClick={() => void save()}
            >
              Save
            </button>
          </div>
        </div>
      )}
    </aside>
  );
};
