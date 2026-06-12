import { useState } from 'react';
import type { ReactNode } from 'react';
import type { FieldFilter, LogEntry } from '../../../core/types/index.ts';
import type { LvLogKind, LvTweakTheme } from '../../contracts/lv-types.ts';

type DetailView = 'fields' | 'meta' | 'pretty' | 'stack' | 'raw';

export interface LvRowDetailProps {
  readonly entry: LogEntry;
  readonly kind?: LvLogKind;
  readonly theme?: LvTweakTheme;
  /** Parser id resolved for this entry's source (Phase 2.E). Surfaced in Meta-tab. */
  readonly parserId?: string;
  /**
   * Resolve activated `~`-namespace logical fields against the entry.
   * Returns `[key, value]` pairs already formatted for display; `null`
   * values are skipped by the container. Drives the Logical block in
   * the Meta-tab where the user can one-click a filter from a
   * cross-format attribute (ADR-0030).
   */
  resolveLogicalRows?: (
    entry: LogEntry,
  ) => ReadonlyArray<readonly [string, string]>;
  onAddFieldFilter: (filter: FieldFilter) => void;
  renderEditor?: (props: {
    readonly value: string;
    readonly language: string;
    readonly theme: 'lv-dark' | 'lv-light';
    readonly wordWrap: boolean;
    readonly height: number;
  }) => ReactNode;
}

export const LvRowDetail = ({
  entry,
  kind,
  theme,
  parserId,
  resolveLogicalRows,
  onAddFieldFilter,
  renderEditor,
}: LvRowDetailProps) => {
  const logicalRows = resolveLogicalRows?.(entry) ?? [];
  const fields = entry.fields;
  const hasFields = Object.keys(fields).length > 0;
  const stack = (fields as Record<string, unknown>).stack;
  const stackLines = Array.isArray(stack) ? (stack as string[]) : [];
  const [view, setView] = useState<DetailView>(
    hasFields
      ? 'fields'
      : kind === 'stacktrace'
        ? 'stack'
        : kind === 'json'
          ? 'pretty'
          : 'meta',
  );

  // Built-in `@`-attributes from ADR-0017. Lives in its own `Meta` tab
  // so it doesn't clutter app-supplied fields. We only include the ones
  // materialised on every entry — @source.kind/@source.name live on
  // the SourceRecord, not the entry.
  const metaFields: Array<readonly [string, string]> = [];
  if (entry.timestamp !== null) {
    metaFields.push(['@ts', new Date(entry.timestamp).toISOString()]);
  }
  metaFields.push(['@level', entry.level]);
  metaFields.push(['@source.id', entry.sourceId]);
  if (entry.filePath) metaFields.push(['@file.path', entry.filePath]);
  if (parserId) metaFields.push(['@parser.id', parserId]);

  // Render a field value to a readable cell — primitives go through
  // `String(v)`, objects/arrays through `JSON.stringify` so nested data
  // (pino `err`, structured payloads) is visible instead of collapsing
  // to `[object Object]`. `null`/`undefined` render as the empty string.
  const formatFieldValue = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  };

  const body =
    view === 'pretty'
      ? JSON.stringify(entry.fields, null, 2)
      : view === 'stack'
        ? stackLines.join('\n')
        : view === 'fields'
          ? Object.entries(fields)
              .map(([k, v]) => `${k}\t${formatFieldValue(v)}`)
              .join('\n')
          : view === 'meta'
            ? [
                ...metaFields.map(([k, v]) => `${k}\t${v}`),
                ...logicalRows.map(([k, v]) => `${k}\t${v}`),
              ].join('\n')
            : entry.raw;

  const copyText =
    view === 'fields'
      ? JSON.stringify(fields, null, 2)
      : view === 'meta'
        ? JSON.stringify(
            Object.fromEntries([...metaFields, ...logicalRows]),
            null,
            2,
          )
        : body;

  return (
    <div className="lv-det">
      <div className="lv-det-bar">
        <span className="lv-det-viewsw" role="tablist">
          {hasFields && (
            <button
              type="button"
              className={`lv-det-viewopt${view === 'fields' ? ' is-on' : ''}`}
              onClick={() => setView('fields')}
            >
              Fields
            </button>
          )}
          {kind === 'json' && (
            <button
              type="button"
              className={`lv-det-viewopt${view === 'pretty' ? ' is-on' : ''}`}
              onClick={() => setView('pretty')}
            >
              Pretty
            </button>
          )}
          {kind === 'stacktrace' && (
            <button
              type="button"
              className={`lv-det-viewopt${view === 'stack' ? ' is-on' : ''}`}
              onClick={() => setView('stack')}
            >
              Stack
            </button>
          )}
          <button
            type="button"
            className={`lv-det-viewopt${view === 'raw' ? ' is-on' : ''}`}
            onClick={() => setView('raw')}
          >
            Raw
          </button>
          <button
            type="button"
            className={`lv-det-viewopt${view === 'meta' ? ' is-on' : ''}`}
            onClick={() => setView('meta')}
            title="Log-viewer @-attributes (timestamp, level, source, file path)"
          >
            Meta
          </button>
        </span>
        <button
          type="button"
          className="lv-det-copybtn"
          onClick={() => navigator.clipboard?.writeText(copyText)}
          title="Copy to clipboard"
          aria-label="Copy"
        >
          <svg viewBox="0 0 14 14" width="12" height="12">
            <rect
              x="3.5"
              y="3.5"
              width="7"
              height="8.5"
              rx="1.2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
            />
            <path
              d="M5.5 2.5 H10 A1 1 0 0 1 11 3.5 V9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      <div className="lv-det-body">
        {view === 'fields' ? (
          <div className="lv-det-tbl">
            {Object.entries(fields).map(([k, v]) => {
              const text = formatFieldValue(v);
              return (
                <div key={k} className="lv-det-row">
                  <span className="lv-det-k">{k}</span>
                  <span className="lv-det-v">{text}</span>
                  <button
                    type="button"
                    className="lv-det-add"
                    title={`Filter where ${k} = ${text}`}
                    onClick={() => onAddFieldFilter({ key: k, op: '=', value: text })}
                  >
                    ＋
                  </button>
                </div>
              );
            })}
          </div>
        ) : view === 'meta' ? (
          <div className="lv-det-tbl">
            {metaFields.map(([k, v]) => (
              <div key={k} className="lv-det-row is-system">
                <span className="lv-det-k">{k}</span>
                <span className="lv-det-v">{v}</span>
                <button
                  type="button"
                  className="lv-det-add"
                  title={`Filter where ${k} = ${v}`}
                  onClick={() => onAddFieldFilter({ key: k, op: '=', value: v })}
                >
                  ＋
                </button>
              </div>
            ))}
            {logicalRows.map(([k, v]) => (
              <div key={k} className="lv-det-row is-system">
                <span className="lv-det-k">{k}</span>
                <span className="lv-det-v">{v}</span>
                <button
                  type="button"
                  className="lv-det-add"
                  title={`Filter where ${k} = ${v}`}
                  onClick={() => onAddFieldFilter({ key: k, op: '=', value: v })}
                >
                  ＋
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className={`lv-det-raw lv-view-${view}`}>
            {renderEditor ? (
              renderEditor({
                value: body,
                language: view === 'pretty' ? 'json' : 'lv-log',
                theme: theme === 'light' ? 'lv-light' : 'lv-dark',
                wordWrap: view === 'raw',
                height: Math.min(260, Math.max(80, body.split('\n').length * 18 + 14)),
              })
            ) : (
              <pre className="lv-det-fallback-pre" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                {body}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
