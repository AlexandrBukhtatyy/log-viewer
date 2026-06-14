import type { ReactNode } from 'react';

export interface LvFormFieldProps {
  /** Field label — sits left of the control (row) or above it (column). */
  readonly label: ReactNode;
  /**
   * `id` of the control this label is bound to. When set, the rendered
   * `<label htmlFor>` focuses the control on click. Omit for composite
   * rows (toggle, folder picker) where there's no single target id.
   */
  readonly htmlFor?: string;
  /** Helper text rendered under the control (`.lv-form-help`). */
  readonly help?: ReactNode;
  /** Inline error rendered under the control (`.lv-form-error`). */
  readonly error?: ReactNode;
  /**
   * `'row'` (default) puts the label left of the control — the standard
   * for modal dialogs. `'column'` stacks the label above, for narrow side
   * panels where a fixed label gutter would crush the input.
   * See docs/conventions/ui-conventions.md → Forms.
   */
  readonly orientation?: 'row' | 'column';
  /**
   * Row-only: align the label to the top of a multi-line control
   * (`textarea`) instead of vertically centering it. No effect in column.
   */
  readonly alignTop?: boolean;
  readonly className?: string;
  /** The control — an `<input>`/`<select>`/`<textarea class="lv-form-input">`. */
  readonly children: ReactNode;
}

/**
 * Canonical form-field layout: a label paired with a single control, with
 * optional help/error text on their own line beneath it. The one
 * sanctioned way to lay out a labelled field — keeps every form visually
 * consistent (see docs/conventions/ui-conventions.md → Forms). Used in:
 *   - LvAddSourceModal (modal, row)
 *   - LvLogicalFieldEditorModal (modal, row)
 *   - LvParsersPanel (narrow panel, column)
 *
 * Composite rows (paired controls, list sections) sit outside this
 * component and span the full width — documented as exceptions.
 */
export const LvFormField = ({
  label,
  htmlFor,
  help,
  error,
  orientation = 'row',
  alignTop = false,
  className,
  children,
}: LvFormFieldProps) => {
  const rowClass = [
    'lv-form-row',
    orientation === 'column' ? 'lv-form-row--col' : '',
    alignTop && orientation === 'row' ? 'lv-form-row--top' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={rowClass}>
      <label className="lv-form-label" htmlFor={htmlFor}>
        {label}
      </label>
      <div className="lv-form-field">
        {children}
        {help !== undefined && help !== null && (
          <span className="lv-form-help">{help}</span>
        )}
        {error !== undefined && error !== null && error !== false && (
          <span className="lv-form-error">{error}</span>
        )}
      </div>
    </div>
  );
};
