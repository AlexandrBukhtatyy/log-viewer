import { useState } from 'react';
import type { ReactNode } from 'react';
import type { LvFieldFilter, LvLogEntry, LvTweakTheme } from '../../contracts/lv-types.ts';

type DetailView = 'fields' | 'pretty' | 'stack' | 'raw';

export interface LvRowDetailProps {
  readonly entry: LvLogEntry;
  readonly theme?: LvTweakTheme;
  onAddFieldFilter: (filter: LvFieldFilter) => void;
  renderEditor?: (props: {
    readonly value: string;
    readonly language: string;
    readonly theme: 'lv-dark' | 'lv-light';
    readonly wordWrap: boolean;
    readonly height: number;
  }) => ReactNode;
}

export const LvRowDetail = ({ entry, theme, onAddFieldFilter, renderEditor }: LvRowDetailProps) => {
  const fields = entry.fields;
  const hasFields = Object.keys(fields).length > 0;
  const [view, setView] = useState<DetailView>(
    hasFields
      ? 'fields'
      : entry.kind === 'stacktrace'
        ? 'stack'
        : entry.kind === 'json'
          ? 'pretty'
          : 'raw',
  );

  const body =
    view === 'pretty'
      ? JSON.stringify(entry.fields, null, 2)
      : view === 'stack'
        ? (entry.stack ?? []).join('\n')
        : view === 'fields'
          ? Object.entries(fields)
              .map(([k, v]) => `${k}\t${String(v)}`)
              .join('\n')
          : entry.raw;

  const copyText = view === 'fields' ? JSON.stringify(fields, null, 2) : body;

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
          {entry.kind === 'json' && (
            <button
              type="button"
              className={`lv-det-viewopt${view === 'pretty' ? ' is-on' : ''}`}
              onClick={() => setView('pretty')}
            >
              Pretty
            </button>
          )}
          {entry.kind === 'stacktrace' && (
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
            {Object.entries(fields).map(([k, v]) => (
              <div key={k} className="lv-det-row">
                <span className="lv-det-k">{k}</span>
                <span className="lv-det-v">{String(v)}</span>
                <button
                  type="button"
                  className="lv-det-add"
                  title={`Filter where ${k} = ${String(v)}`}
                  onClick={() => onAddFieldFilter({ key: k, op: '=', value: String(v) })}
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
