import type { ReactNode } from 'react';
import type { LogEntry } from '../../core/types/index.ts';
import { lvFmtTime } from '../utils/lv-format.ts';
import type { LvFileNode } from './lv-types.ts';

/**
 * Context passed to a column's `renderCell`. Carries everything a
 * built-in renderer (timestamp, level, service, file) needs to draw
 * itself — plus `renderText`, a hook that lets a custom renderer
 * inherit the row's text-highlight (Cmd+F find) handling without
 * pulling utilities directly.
 */
export interface LvCellRenderContext {
  readonly entry: LogEntry;
  readonly fileMeta: LvFileNode | null;
  readonly showDate: boolean;
  readonly renderText: (text: string) => ReactNode;
  /**
   * Default value extracted by the container (`cellValueOf`). Already
   * `formatCellValue`-applied to a string. Custom renderers can
   * ignore this if they compute the value from `entry` directly.
   */
  readonly defaultText: string;
  /**
   * The fallback resolved value as returned by `cellValueOf` before
   * formatting — opaque to renderers but exposed so future custom
   * renderers (chips, badges) can branch on type.
   */
  readonly defaultValue: unknown;
}

/**
 * Descriptor of a single column in the log table. Built-in keys
 * (`@ts`/`@level`/`@source.name`/`@file`) carry a custom `renderCell`
 * so their cell preserves the legacy visual treatment (formatted
 * timestamp, level tag, service text, file basename). Dynamic JSON
 * keys and virtual regex columns rely on the default renderer (which
 * just prints `defaultText` through `renderText`).
 */
export interface LvColumnDescriptor {
  readonly key: string;
  readonly label: string;
  readonly defaultWidthPx: number;
  readonly headerClass?: string;
  readonly cellClass?: string;
  readonly renderCell?: (ctx: LvCellRenderContext) => ReactNode;
}

const basename = (path: string | undefined | null): string => {
  if (!path) return '';
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return i === -1 ? path : path.slice(i + 1);
};

const serviceFor = (entry: LogEntry, fileMeta: LvFileNode | null): string => {
  const fromFields = (entry.fields as Record<string, unknown>).service;
  if (typeof fromFields === 'string' && fromFields.length > 0) return fromFields;
  return fileMeta?.service ?? '—';
};

/**
 * Built-in column descriptors. Order is informational — `LvColumnPicker`
 * sorts by `presenceRate` for dynamic keys and falls back to catalog
 * order for built-ins.
 */
export const BUILT_IN_COLUMN_DESCRIPTORS: ReadonlyArray<LvColumnDescriptor> = [
  {
    key: '@ts',
    label: 'timestamp',
    defaultWidthPx: 178,
    headerClass: 'lv-sh-ts',
    cellClass: 'lv-row-ts',
    renderCell: ({ entry, showDate, renderText }) =>
      renderText(lvFmtTime(entry.timestamp, showDate)),
  },
  {
    key: '@level',
    label: 'level',
    defaultWidthPx: 58,
    headerClass: 'lv-sh-lvl',
    // `lv-row-lvl` is the legacy span; we keep the level-tag colour via
    // `lv-level-tag-<level>` so existing CSS stays effective.
    cellClass: 'lv-row-lvl',
    renderCell: ({ entry, renderText }) => (
      <span className={`lv-level-tag-${entry.level}`}>
        {renderText(entry.level)}
      </span>
    ),
  },
  {
    key: '@source.name',
    label: 'service',
    defaultWidthPx: 120,
    headerClass: 'lv-sh-svc',
    cellClass: 'lv-row-svc',
    renderCell: ({ entry, fileMeta, renderText }) =>
      renderText(serviceFor(entry, fileMeta)),
  },
  {
    key: '@file',
    label: '@file',
    defaultWidthPx: 150,
    headerClass: 'lv-sh-file',
    cellClass: 'lv-row-file',
    renderCell: ({ entry, fileMeta, renderText }) =>
      renderText(basename(fileMeta?.path ?? entry.filePath)),
  },
];

const BUILT_IN_BY_KEY: ReadonlyMap<string, LvColumnDescriptor> = new Map(
  BUILT_IN_COLUMN_DESCRIPTORS.map((d) => [d.key, d]),
);

/** Lookup helper — returns the built-in descriptor for `key`, or `null`. */
export const builtInColumn = (key: string): LvColumnDescriptor | null =>
  BUILT_IN_BY_KEY.get(key) ?? null;
