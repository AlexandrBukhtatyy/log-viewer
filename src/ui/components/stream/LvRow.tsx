import type { ReactNode } from 'react';
import type { FieldFilter, LogEntry } from '../../../core/types/index.ts';
import type {
  LvColumnPref,
  LvFileNode,
  LvLogKind,
  LvTweakDensity,
  LvTweakTheme,
} from '../../contracts/lv-types.ts';
import { lvFmtTime } from '../../utils/lv-format.ts';
import { lvHighlight } from '../../utils/lv-highlight.tsx';
import { LvRowDetail } from './LvRowDetail.tsx';

export interface LvRowProps {
  readonly entry: LogEntry;
  /** File metadata for entry.sourceId — supplies file name, path and visual kind. */
  readonly fileMeta: LvFileNode | null;
  readonly index: number;
  readonly density: LvTweakDensity;
  readonly showDate: boolean;
  readonly wrap: boolean;
  readonly query: string;
  readonly useRegex: boolean;
  readonly caseSensitive: boolean;
  readonly wholeWord: boolean;
  readonly selected: boolean;
  readonly expanded: boolean;
  readonly bookmarked: boolean;
  readonly isFindMatch?: boolean;
  readonly isFindCurrent?: boolean;
  onSelect: () => void;
  onToggleExpand: () => void;
  onBookmark: () => void;
  onOpenAtLine: (e: React.MouseEvent<HTMLElement>, entry: LogEntry) => void;
  onContextMenu: (e: React.MouseEvent<HTMLElement>, entry: LogEntry) => void;
  onAddFieldFilter: (ff: FieldFilter) => void;
  readonly theme?: LvTweakTheme;
  readonly indentPx?: number;
  /** User-added columns rendered between FILE and MESSAGE (ADR-0017). */
  readonly columns?: ReadonlyArray<LvColumnPref>;
  /** Inline grid-template-columns matching the LvViewer header. */
  readonly gridTemplate?: string;
  /**
   * Resolves the cell value for a given column key. Container injects
   * this so LvRow stays free of core/ runtime imports (ADR-0002).
   */
  cellValueOf?: (entry: LogEntry, key: string) => unknown;
  renderDetailEditor?: (props: {
    readonly value: string;
    readonly language: string;
    readonly theme: 'lv-dark' | 'lv-light';
    readonly wordWrap: boolean;
    readonly height: number;
  }) => ReactNode;
}

const serviceFromEntry = (entry: LogEntry, fileMeta: LvFileNode | null): string => {
  const fromFields = (entry.fields as Record<string, unknown>).service;
  if (typeof fromFields === 'string' && fromFields.length > 0) return fromFields;
  return fileMeta?.service ?? '—';
};

const formatCellValue = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return '';
  }
};

export const LvRow = ({
  entry,
  fileMeta,
  index,
  density,
  showDate,
  wrap,
  query,
  useRegex,
  caseSensitive,
  wholeWord,
  selected,
  expanded,
  bookmarked,
  isFindMatch = false,
  isFindCurrent = false,
  onToggleExpand,
  onBookmark,
  onOpenAtLine,
  onContextMenu,
  onAddFieldFilter,
  theme,
  indentPx = 0,
  columns,
  gridTemplate,
  cellValueOf,
  renderDetailEditor,
}: LvRowProps) => {
  const handleRowClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (
      (e.target as HTMLElement).closest('.lv-row-msg') &&
      window.getSelection()?.toString()
    )
      return;
    onToggleExpand();
  };
  const className =
    `lv-row lv-level-${entry.level}` +
    (selected ? ' is-selected' : '') +
    (expanded ? ' is-expanded' : '') +
    (bookmarked ? ' is-bookmarked' : '') +
    (indentPx ? ' is-nested' : '') +
    (isFindMatch ? ' is-find-match' : '') +
    (isFindCurrent ? ' is-find-current' : '');
  const tsTitle =
    entry.timestamp === null ? '' : new Date(entry.timestamp).toISOString();
  const fileName = fileMeta?.name ?? '—';
  const filePath = fileMeta?.path ?? '';
  const fileKind: LvLogKind | undefined = fileMeta?.kind;
  const service = serviceFromEntry(entry, fileMeta);
  return (
    <>
      <div
        className={className}
        data-density={density}
        data-row-idx={index}
        style={{
          ...(gridTemplate ? { gridTemplateColumns: gridTemplate } : {}),
          ...(indentPx ? { paddingLeft: indentPx } : {}),
        }}
        onClick={handleRowClick}
        onContextMenu={(e) => {
          e.preventDefault();
          onContextMenu(e, entry);
        }}
      >
        <span className="lv-row-gutter">
          {bookmarked ? <span className="lv-bm">●</span> : <span className="lv-ln">{entry.seq}</span>}
        </span>
        <span className="lv-row-caret">
          <svg
            viewBox="0 0 10 10"
            width="10"
            height="10"
            style={{ transform: expanded ? 'rotate(90deg)' : 'none' }}
          >
            <path
              d="M3.5 2 L7 5 L3.5 8"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span className="lv-row-ts" title={tsTitle}>
          {lvFmtTime(entry.timestamp, showDate)}
        </span>
        <span className={`lv-row-lvl lv-level-tag-${entry.level}`}>{entry.level}</span>
        <span className="lv-row-svc" title={service}>
          {service}
        </span>
        <span className="lv-row-file" title={filePath}>
          {fileName}
        </span>
        {columns?.map((c) => {
          const v = cellValueOf ? cellValueOf(entry, c.key) : undefined;
          const text = formatCellValue(v);
          return (
            <span
              key={c.key}
              className="lv-row-cell"
              data-empty={text === '' ? '1' : undefined}
              title={text}
            >
              {text || '—'}
            </span>
          );
        })}
        <span className={`lv-row-msg${wrap ? ' wrap' : ''}`}>
          {lvHighlight(entry.message, query, useRegex, caseSensitive, wholeWord)}
        </span>
        <span className="lv-row-actions" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className={`lv-row-bm${bookmarked ? ' is-on' : ''}`}
            onClick={onBookmark}
            title="Bookmark"
          >
            <svg viewBox="0 0 10 12" width="10" height="12">
              <path
                d="M1.5 1.5 H8.5 V10.5 L5 8.2 L1.5 10.5 Z"
                fill={bookmarked ? 'currentColor' : 'none'}
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            className="lv-row-open"
            onClick={(e) => onOpenAtLine(e, entry)}
            title="Open at line"
          >
            <svg viewBox="0 0 12 12" width="12" height="12">
              <path
                d="M4 2 H2 V10 H10 V8 M7 2 H10 V5 M10 2 L5 7"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </span>
      </div>
      {expanded && (
        <div
          className={`lv-row-detail lv-level-${entry.level}${indentPx ? ' is-nested' : ''}`}
          style={indentPx ? { paddingLeft: indentPx } : undefined}
        >
          <LvRowDetail
            entry={entry}
            kind={fileKind}
            onAddFieldFilter={onAddFieldFilter}
            theme={theme}
            renderEditor={renderDetailEditor}
          />
        </div>
      )}
    </>
  );
};
