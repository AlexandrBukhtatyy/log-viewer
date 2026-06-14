import { useMemo, useState } from 'react';
import type {
  LogicalField,
  LogicalFieldsConfig,
} from '../../../core/types/index.ts';
import { LvLogicalFieldEditorModal } from '../modals/LvLogicalFieldEditorModal.tsx';

interface CoverageSourceView {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly matchedEntries: number;
  readonly totalEntries: number;
  readonly extractorHits: ReadonlyArray<number | null>;
}

interface CoverageView {
  readonly sources: ReadonlyArray<CoverageSourceView>;
  readonly regexExtractorsSkipped: number;
}

const PREFIX = '~';

const extractorSummary = (field: LogicalField): string => {
  let fieldCount = 0;
  let regexCount = 0;
  let regexOnJsonCount = 0;
  for (const ex of field.extractors) {
    if (ex.type === 'field') fieldCount++;
    else if (ex.type === 'regex-on-json') regexOnJsonCount++;
    else regexCount++;
  }
  const parts: string[] = [];
  if (fieldCount > 0)
    parts.push(`${fieldCount} field${fieldCount === 1 ? '' : 's'}`);
  if (regexOnJsonCount > 0)
    parts.push(`${regexOnJsonCount} regex-on-json`);
  if (regexCount > 0) parts.push(`${regexCount} regex`);
  return parts.join(' + ') || 'no extractors';
};

interface RowProps {
  readonly field: LogicalField;
  readonly active: boolean;
  readonly coverage?: CoverageView | 'loading' | 'error';
  onToggle(id: string): void;
  onEdit?: (id: string) => void;
  onRemove?: (id: string) => void;
  onLoadCoverage?: (id: string) => void;
}

const CoverageBadge = ({ coverage }: { coverage: CoverageView }) => {
  const sources = coverage.sources;
  const sourcesWithMatch = sources.filter((s) => s.matchedEntries > 0).length;
  return (
    <span
      className="lv-colpick-meta"
      title="Sources where at least one extractor matched (regex extractors are not counted)"
      style={{ marginLeft: 6 }}
    >
      {sourcesWithMatch}/{sources.length} sources
    </span>
  );
};

const CoverageDrill = ({
  field,
  coverage,
}: {
  field: LogicalField;
  coverage: CoverageView;
}) => (
  <div
    className="lv-form-help"
    style={{ padding: '4px 0 0 0', marginTop: 4 }}
  >
    {coverage.sources.length === 0 ? (
      <span>No sources indexed yet.</span>
    ) : (
      <div className="lv-det-tbl">
        {coverage.sources.map((s) => {
          // First field-extractor that actually produced any value
          // in this source — surfaces the dominant branch.
          const winning = field.extractors
            .map((ex, i) => ({ ex, idx: i }))
            .find(
              (x) =>
                s.extractorHits[x.idx] !== null &&
                (s.extractorHits[x.idx] ?? 0) > 0,
            );
          return (
            <div key={s.sourceId} className="lv-det-row is-system">
              <span className="lv-det-k">
                {s.matchedEntries > 0 ? '✓' : '✗'} {s.sourceName}
              </span>
              <span className="lv-det-v">
                {s.matchedEntries.toLocaleString()} /{' '}
                {s.totalEntries.toLocaleString()} entries
                {winning !== undefined && winning.ex.type === 'field' && (
                  <span style={{ marginLeft: 6, opacity: 0.7 }}>
                    via #{winning.idx + 1} (${winning.ex.path})
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    )}
    {coverage.regexExtractorsSkipped > 0 && (
      <div style={{ marginTop: 4, opacity: 0.7 }}>
        {coverage.regexExtractorsSkipped} regex extractor
        {coverage.regexExtractorsSkipped === 1 ? '' : 's'} skipped — only
        counted in column display.
      </div>
    )}
  </div>
);

const Row = ({
  field,
  active,
  coverage,
  onToggle,
  onEdit,
  onRemove,
  onLoadCoverage,
}: RowProps) => {
  const [drillOpen, setDrillOpen] = useState(false);
  const toggleDrill = (): void => {
    if (!drillOpen && coverage === undefined) onLoadCoverage?.(field.id);
    setDrillOpen((v) => !v);
  };
  return (
    <div className={`lv-parsers-row${active ? ' is-active' : ''}`}>
      <div className="lv-parsers-row-main">
        <span className="lv-parsers-row-id">
          {PREFIX}
          {field.id}
        </span>
        <span className="lv-parsers-row-label">{field.label}</span>
        <span className="lv-parsers-row-kind">{extractorSummary(field)}</span>
        {coverage === 'loading' && (
          <span className="lv-colpick-meta" style={{ marginLeft: 6 }}>
            …
          </span>
        )}
        {coverage === 'error' && (
          <span className="lv-colpick-meta" style={{ marginLeft: 6 }}>
            err
          </span>
        )}
        {typeof coverage === 'object' && <CoverageBadge coverage={coverage} />}
        {field.description !== undefined && field.description.length > 0 && (
          <span
            className="lv-form-help"
            style={{ display: 'block', marginTop: 4 }}
          >
            {field.description}
          </span>
        )}
        {active && typeof coverage === 'object' && drillOpen && (
          <CoverageDrill field={field} coverage={coverage} />
        )}
      </div>
      <div className="lv-parsers-row-act">
        {active && onLoadCoverage !== undefined && (
          <button
            type="button"
            className="lv-btn lv-btn-secondary"
            onClick={toggleDrill}
            title="Show per-source extractor coverage"
          >
            {drillOpen ? 'Hide' : 'Coverage'}
          </button>
        )}
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
};

type EditState =
  | { mode: 'closed' }
  | { mode: 'new' }
  | { mode: 'edit'; id: string };

export interface LvLogicalFieldSuggestion {
  readonly field: LogicalField;
  readonly matchedKeys: ReadonlyArray<string>;
}

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
   * Templates the container thinks the user should activate based on
   * keys observed in open sources (ADR-0030 Phase 3). The panel
   * surfaces them in a dedicated section above the catalog with the
   * matched keys explained so the user understands the suggestion.
   */
  readonly suggestions?: ReadonlyArray<LvLogicalFieldSuggestion>;
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
  /** Serialize the current config (callback returns a JSON string). */
  exportConfig?: () => string;
  /**
   * Parse + apply an imported config. Returns a human-readable error
   * string or `null` on success. The panel shows the error inline.
   */
  importConfig?: (raw: string) => string | null;
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
  /**
   * Optional async callback: ask the worker for a coverage report.
   * Returns `null` when the worker is not ready. The panel caches
   * the result per field id and exposes it through the drill-down.
   */
  getCoverage?: (field: LogicalField) => Promise<CoverageView | null>;
}

/**
 * Settings panel for the `~`-namespace logical fields (ADR-0030).
 * Lists built-in templates + user-defined customs, lets the user
 * toggle activation, and opens a modal editor for creating / editing
 * customs.
 */
type CoverageEntry = CoverageView | 'loading' | 'error';

export const LvLogicalFieldsPanel = ({
  fields,
  activeIds,
  suggestions = [],
  config,
  onToggle,
  onAddCustom,
  onUpdateCustom,
  onRemoveCustom,
  validate,
  getCoverage,
  exportConfig,
  importConfig,
}: LvLogicalFieldsPanelProps) => {
  const [edit, setEdit] = useState<EditState>({ mode: 'closed' });
  const [ioError, setIoError] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<
    Readonly<Record<string, CoverageEntry>>
  >({});

  const activeSet = useMemo(() => new Set(activeIds), [activeIds]);
  const customIds = useMemo(
    () => new Set(config.customFields.map((f) => f.id)),
    [config.customFields],
  );

  const loadCoverage = (id: string): void => {
    if (getCoverage === undefined) return;
    const field = fields.find((f) => f.id === id);
    if (field === undefined) return;
    setCoverage((m) => ({ ...m, [id]: 'loading' }));
    getCoverage(field)
      .then((cov) => {
        if (cov === null) {
          setCoverage((m) => ({ ...m, [id]: 'error' }));
          return;
        }
        setCoverage((m) => ({ ...m, [id]: cov }));
      })
      .catch(() => {
        setCoverage((m) => ({ ...m, [id]: 'error' }));
      });
  };

  const active = fields.filter((f) => activeSet.has(f.id));
  const inactive = fields.filter((f) => !activeSet.has(f.id));

  const startNew = (): void => setEdit({ mode: 'new' });
  const startEdit = (id: string): void => {
    const f = config.customFields.find((x) => x.id === id);
    if (f === undefined) return;
    setEdit({ mode: 'edit', id });
  };
  const cancel = (): void => setEdit({ mode: 'closed' });

  const handleSave = (candidate: LogicalField): void => {
    if (edit.mode === 'edit') onUpdateCustom(candidate);
    else onAddCustom(candidate);
  };

  const isCustom = (id: string): boolean => customIds.has(id);

  const initialField =
    edit.mode === 'edit'
      ? config.customFields.find((f) => f.id === edit.id)
      : undefined;

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
        {exportConfig !== undefined && (
          <button
            type="button"
            className="lv-btn lv-btn-secondary"
            onClick={() => {
              const raw = exportConfig();
              const blob = new Blob([raw], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'logical-fields.json';
              document.body.appendChild(a);
              a.click();
              a.remove();
              URL.revokeObjectURL(url);
              setIoError(null);
            }}
            title="Download the current config as JSON"
          >
            Export
          </button>
        )}
        {importConfig !== undefined && (
          <button
            type="button"
            className="lv-btn lv-btn-secondary"
            onClick={() => {
              const inp = document.createElement('input');
              inp.type = 'file';
              inp.accept = 'application/json,.json';
              inp.onchange = async () => {
                const file = inp.files?.[0];
                if (file === undefined) return;
                const text = await file.text();
                const err = importConfig(text);
                setIoError(err);
              };
              inp.click();
            }}
            title="Replace the current config from a JSON file"
          >
            Import
          </button>
        )}
      </div>
      {ioError !== null && (
        <div
          className="lv-tset-vf-error"
          role="alert"
          style={{ margin: '0 12px' }}
        >
          {ioError}
        </div>
      )}

      <LvLogicalFieldEditorModal
        open={edit.mode !== 'closed'}
        mode={edit.mode === 'edit' ? 'edit' : 'new'}
        initial={initialField}
        config={config}
        validate={validate}
        onSave={handleSave}
        onClose={cancel}
      />

      {active.length > 0 && (
        <div className="lv-parsers-section-hd">Active</div>
      )}
      <div className="lv-parsers-list">
        {active.map((f) => (
          <Row
            key={f.id}
            field={f}
            active
            coverage={coverage[f.id]}
            onToggle={onToggle}
            onEdit={isCustom(f.id) ? startEdit : undefined}
            onRemove={isCustom(f.id) ? onRemoveCustom : undefined}
            onLoadCoverage={
              getCoverage !== undefined ? loadCoverage : undefined
            }
          />
        ))}
      </div>

      {suggestions.length > 0 && (
        <>
          <div className="lv-parsers-section-hd">Suggested</div>
          <div className="lv-parsers-list">
            {suggestions.map(({ field: f, matchedKeys }) => (
              <div key={`sugg-${f.id}`} className="lv-parsers-row">
                <div className="lv-parsers-row-main">
                  <span className="lv-parsers-row-id">
                    {PREFIX}
                    {f.id}
                  </span>
                  <span className="lv-parsers-row-label">{f.label}</span>
                  <span className="lv-parsers-row-kind">
                    matches: {matchedKeys.join(', ')}
                  </span>
                  {f.description !== undefined && f.description.length > 0 && (
                    <span
                      className="lv-form-help"
                      style={{ display: 'block', marginTop: 4 }}
                    >
                      {f.description}
                    </span>
                  )}
                </div>
                <div className="lv-parsers-row-act">
                  <button
                    type="button"
                    className="lv-btn lv-btn-secondary"
                    onClick={() => onToggle(f.id)}
                  >
                    Activate
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

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
