import { useMemo } from 'react';
import type { LogicalField } from '../../../core/types/index.ts';

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
  readonly onToggle: (id: string) => void;
}

const Row = ({ field, active, onToggle }: RowProps) => (
  <div className={`lv-parsers-row${active ? ' is-active' : ''}`}>
    <div className="lv-parsers-row-main">
      <span className="lv-parsers-row-id">
        {PREFIX}
        {field.id}
      </span>
      <span className="lv-parsers-row-label">{field.label}</span>
      <span className="lv-parsers-row-kind">{extractorSummary(field)}</span>
      {field.description !== undefined && (
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
    </div>
  </div>
);

export interface LvLogicalFieldsPanelProps {
  /**
   * Full catalog of logical fields the user can choose from
   * (built-in templates + user-defined). The panel is dumb: order
   * within the array decides display order within each section.
   */
  readonly fields: ReadonlyArray<LogicalField>;
  /** Currently activated ids — toggles per-row UI state. */
  readonly activeIds: ReadonlyArray<string>;
  onToggle(id: string): void;
}

/**
 * Settings panel for the `~`-namespace logical fields (ADR-0030). Phase 1
 * scope: list built-in templates and let the user flip them on/off.
 * Custom-field authoring, coverage drill-down and other power-user bits
 * land in later phases.
 */
export const LvLogicalFieldsPanel = ({
  fields,
  activeIds,
  onToggle,
}: LvLogicalFieldsPanelProps) => {
  const activeSet = useMemo(() => new Set(activeIds), [activeIds]);

  const active = fields.filter((f) => activeSet.has(f.id));
  const inactive = fields.filter((f) => !activeSet.has(f.id));

  return (
    <aside className="lv-sidebar lv-fields-panel">
      <div className="lv-sb-cta">
        <button
          type="button"
          className="lv-add-src-btn"
          disabled
          title="Custom logical fields are coming in Phase 2"
        >
          <span className="lv-add-src-plus" aria-hidden="true">＋</span>
          <span>New field (soon)</span>
        </button>
      </div>

      {active.length > 0 && (
        <div className="lv-parsers-section-hd">Active</div>
      )}
      <div className="lv-parsers-list">
        {active.map((f) => (
          <Row key={f.id} field={f} active onToggle={onToggle} />
        ))}
      </div>

      {inactive.length > 0 && (
        <div className="lv-parsers-section-hd">Catalog</div>
      )}
      <div className="lv-parsers-list">
        {inactive.map((f) => (
          <Row key={f.id} field={f} active={false} onToggle={onToggle} />
        ))}
      </div>

      {active.length === 0 && (
        <div className="lv-parsers-empty">
          Activate a template above to make it available in filter / group-by
          / column pickers across all tabs.
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
