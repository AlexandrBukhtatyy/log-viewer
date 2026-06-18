import type { ReactNode } from 'react';
import type { FieldFilter, LogEntry } from '../../../core/types/index.ts';
import type {
  LvColumnPref,
  LvFileNode,
  LvGutterMode,
  LvLogKind,
  LvTableView,
  LvTweakDensity,
  LvTweakTheme,
} from '../../contracts/lv-types.ts';
import { builtInColumn } from '../../contracts/lv-column-registry.tsx';
import { lvHighlight } from '../../utils/lv-highlight.tsx';
import { LvRowDetail } from './LvRowDetail.tsx';

export interface LvRowProps {
  readonly entry: LogEntry;
  /** File metadata for entry.sourceId — supplies file name, path and visual kind. */
  readonly fileMeta: LvFileNode | null;
  readonly index: number;
  readonly density: LvTweakDensity;
  readonly showDate: boolean;
  /**
   * Highlight settings for the message column. `null` disables
   * highlighting. The filter-bar query is intentionally NOT plumbed
   * here — it filters via the worker; this prop carries only the
   * Cmd+F find-in-window state from `LvViewer`.
   */
  readonly highlight: {
    readonly query: string;
    readonly useRegex: boolean;
    readonly caseSensitive: boolean;
    readonly wholeWord: boolean;
  } | null;
  readonly selected: boolean;
  readonly expanded: boolean;
  readonly bookmarked: boolean;
  readonly isFindMatch?: boolean;
  readonly isFindCurrent?: boolean;
  /**
   * Controls what the gutter cell shows. `line` (default) renders the
   * physical line number in the source file; `entry` renders the
   * per-file logical record ordinal; `both` renders them as
   * `<line>·<entry>`.
   */
  readonly gutterMode?: LvGutterMode;
  /**
   * Table rendering mode. In `raw` (default) the main content column
   * shows the full original log line (`entry.raw`); in `columns` it
   * shows the parser-extracted message (`entry.message`) alongside the
   * user-picked `columns`. As long as no column is picked the `columns`
   * view still falls back to the raw line — `entry.message` may be empty
   * for parsers that don't extract one, so the raw line is the safer
   * default until the user adds a column.
   */
  readonly tableView?: LvTableView;
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
  /** Lookup of parser id for the entry's source — surfaced via Meta-вкладка. */
  parserIdOf?: (entry: LogEntry) => string | undefined;
  /**
   * Resolve activated logical fields (`~name`) against the entry —
   * forwarded to LvRowDetail so the Meta-tab can offer a one-click
   * filter on cross-format attributes (ADR-0030).
   */
  resolveLogicalRows?: (
    entry: LogEntry,
  ) => ReadonlyArray<readonly [string, string]>;
  renderDetailEditor?: (props: {
    readonly value: string;
    readonly language: string;
    readonly theme: 'lv-dark' | 'lv-light';
    readonly wordWrap: boolean;
    readonly height: number;
  }) => ReactNode;
}

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
  highlight,
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
  parserIdOf,
  resolveLogicalRows,
  renderDetailEditor,
  gutterMode = 'line',
  tableView = 'raw',
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
  const fileKind: LvLogKind | undefined = fileMeta?.kind;
  const renderCell = (text: string) =>
    highlight
      ? lvHighlight(
          text,
          highlight.query,
          highlight.useRegex,
          highlight.caseSensitive,
          highlight.wholeWord,
        )
      : text;
  // Gutter content depends on the user's choice. Fall back to `seq`
  // for pre-v5 rows (lineNumber/fileSeq=0) so the column never goes
  // blank for old persisted entries.
  const lineNum = entry.lineNumber > 0 ? entry.lineNumber : entry.seq;
  const entryNum = entry.fileSeq > 0 ? entry.fileSeq : entry.seq;
  const gutterText =
    gutterMode === 'entry'
      ? String(entryNum)
      : gutterMode === 'both'
        ? `${lineNum}·${entryNum}`
        : String(lineNum);
  const gutterTitle =
    gutterMode === 'both'
      ? `line ${lineNum} · entry ${entryNum}`
      : gutterMode === 'entry'
        ? `entry #${entryNum}`
        : `line ${lineNum}`;
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
        <span className="lv-row-gutter" title={gutterTitle}>
          {bookmarked ? (
            <span className="lv-bm">●</span>
          ) : (
            <span className="lv-ln">{gutterText}</span>
          )}
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
        {columns?.map((c) => {
          const d = builtInColumn(c.key);
          const v = cellValueOf ? cellValueOf(entry, c.key) : undefined;
          const text = formatCellValue(v);
          if (d?.renderCell) {
            return (
              <span
                key={c.key}
                className={d.cellClass ?? 'lv-row-cell'}
                title={text || d.label}
              >
                {d.renderCell({
                  entry,
                  fileMeta,
                  showDate,
                  renderText: renderCell,
                  defaultText: text,
                  defaultValue: v,
                })}
              </span>
            );
          }
          return (
            <span
              key={c.key}
              className="lv-row-cell"
              data-empty={text === '' ? '1' : undefined}
              title={text}
            >
              {text === '' ? '—' : renderCell(text)}
            </span>
          );
        })}
        <span className="lv-row-msg">
          {renderCell(
            tableView === 'columns' && (columns?.length ?? 0) > 0
              ? entry.message
              : entry.raw,
          )}
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
            parserId={parserIdOf?.(entry)}
            resolveLogicalRows={resolveLogicalRows}
          />
        </div>
      )}
    </>
  );
};
