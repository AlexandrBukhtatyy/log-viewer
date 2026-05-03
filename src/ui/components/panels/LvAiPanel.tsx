import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { LvFieldFilter, LvFilters, LvLogLevel } from '../../contracts/lv-types.ts';

interface AiMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly ts: string;
  readonly body: ReactNode;
}

interface Suggestion {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
}

const SUGGESTIONS: Suggestion[] = [
  { id: 'sp1', label: 'Summarize errors in the last hour', icon: '⚠' },
  { id: 'sp2', label: 'What caused the 502 spike at 14:32?', icon: '◎' },
  { id: 'sp3', label: 'Compare auth-svc latency today vs yesterday', icon: '≈' },
  { id: 'sp4', label: 'Find traces touching user u_184502', icon: '⌕' },
];

export type LvAiFilterPatch = Partial<{
  query: string;
  useRegex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  levels: Set<LvLogLevel>;
  fieldFilters: LvFieldFilter[];
}>;

export interface LvAiPanelProps {
  readonly fileCount: number;
  readonly lineCount: number;
  readonly filters: LvFilters;
  onRunFilter: (patch: LvAiFilterPatch) => void;
  onJumpTo: (target: { fileId: string; line?: number }) => void;
  onComplete?: (prompt: string) => Promise<string>;
}

export const LvAiPanel = ({
  fileCount,
  lineCount,
  filters,
  onRunFilter,
  onJumpTo,
  onComplete,
}: LvAiPanelProps) => {
  const seedMessages: AiMessage[] = [
    {
      id: 'm-welcome',
      role: 'assistant',
      ts: '—',
      body: (
        <>
          <p>
            Готов копаться в логах. У меня контекст из <b>{fileCount}</b> выбранных файлов,
            текущих фильтров и закладок.
          </p>
          <p className="lv-ai-muted">Спроси что-нибудь или выбери подсказку снизу.</p>
        </>
      ),
    },
    {
      id: 'm-q1',
      role: 'user',
      ts: '14:41',
      body: 'Почему в billing-svc за последний час так много 5xx?',
    },
    {
      id: 'm-a1',
      role: 'assistant',
      ts: '14:41',
      body: (
        <>
          <p>
            Коротко: <b>pool saturation в <code>pg-primary</code></b>. В <code>billing-svc</code>{' '}
            между <b>14:28–14:36</b> — 47 ошибок{' '}
            <span className="lv-level-tag-error">error</span>, из них 41 совпадает по пути{' '}
            <code>/invoices/issue</code>.
          </p>
          <ol className="lv-ai-list">
            <li>
              Всплеск начинается в{' '}
              <a
                className="lv-ai-link"
                onClick={() => onJumpTo({ fileId: 'billing-json' })}
              >
                billing.json.log:14:28:02
              </a>{' '}
              — <code>connection pool exhausted (size=20)</code>.
            </li>
            <li>
              Следом <b>23×</b> <code>deadlock detected</code> на <code>invoice_id</code>;
              транзакции ретраятся и падают по таймауту.
            </li>
            <li>
              Триггер совпал с деплоем <code>billing@1.14.3</code> в 14:27 (из{' '}
              <code>access-log</code>).
            </li>
          </ol>
          <div className="lv-ai-actions">
            <button
              type="button"
              className="lv-ai-chip"
              onClick={() =>
                onRunFilter({
                  query: 'pool exhausted',
                  useRegex: false,
                  levels: new Set<LvLogLevel>(['error', 'warn']),
                })
              }
            >
              <span>Apply filter:</span> <code>pool exhausted</code> · error+warn
            </button>
            <button
              type="button"
              className="lv-ai-chip"
              onClick={() =>
                onRunFilter({
                  fieldFilters: [
                    { key: 'service', op: '=', value: 'billing-svc' },
                    { key: 'path', op: '~', value: '/invoices/issue' },
                  ],
                })
              }
            >
              <span>Focus:</span> service=billing-svc · path~/invoices/issue
            </button>
          </div>
          <div className="lv-ai-sources">
            <span className="lv-ai-sources-hd">Sources</span>
            <button
              type="button"
              className="lv-ai-src"
              onClick={() => onJumpTo({ fileId: 'billing-json' })}
            >
              billing.json.log
            </button>
            <button
              type="button"
              className="lv-ai-src"
              onClick={() => onJumpTo({ fileId: 'access-log' })}
            >
              access.log
            </button>
            <button
              type="button"
              className="lv-ai-src"
              onClick={() => onJumpTo({ fileId: 'billing-trace' })}
            >
              billing.trace.log
            </button>
          </div>
        </>
      ),
    },
  ];

  const [messages, setMessages] = useState<AiMessage[]>(seedMessages);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length, busy]);

  const send = async (text?: string) => {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    const now = new Date();
    const ts = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    setMessages((m) => [...m, { id: `u-${Date.now()}`, role: 'user', ts, body: q }]);
    setInput('');
    setBusy(true);
    try {
      if (!onComplete) {
        setMessages((m) => [
          ...m,
          {
            id: `a-${Date.now()}`,
            role: 'assistant',
            ts,
            body: <span className="lv-ai-muted">AI completion is not connected in this preview.</span>,
          },
        ]);
        return;
      }
      const contextLine = `Context: ${fileCount} log files, ~${lineCount.toLocaleString()} lines. Active filter query: "${filters.query || '(none)'}".`;
      const prompt = `You are a log-analysis assistant inside a log viewer. Be concise and technical. Use short paragraphs, bullet points when listing causes, and inline \`code\` for identifiers.\n\n${contextLine}\n\nQuestion: ${q}`;
      const reply = await onComplete(prompt);
      setMessages((m) => [
        ...m,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          ts,
          body: <div className="lv-ai-md">{reply}</div>,
        },
      ]);
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          ts,
          body: (
            <span className="lv-ai-muted">
              Не удалось получить ответ ({String((e as Error)?.message ?? e)}).
            </span>
          ),
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <aside className="lv-sidebar lv-ai">
      <div className="lv-sb-hd">
        <div className="lv-sb-title">
          <span className="lv-sb-title-text">AI assistant</span>
          <span className="lv-ai-model">Haiku 4.5</span>
        </div>
      </div>

      <div className="lv-ai-ctx">
        <span className="lv-ai-ctx-dot" />
        <span>
          Grounded in <b>{fileCount}</b> file{fileCount !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="lv-ai-stream" ref={scrollRef}>
        {messages.map((m) => (
          <div key={m.id} className={`lv-ai-msg lv-ai-${m.role}`}>
            <div className="lv-ai-avatar">
              {m.role === 'assistant' ? (
                <svg viewBox="0 0 14 14" width="12" height="12">
                  <path
                    d="M7 1.6 L8.1 5.2 L11.7 6.3 L8.1 7.4 L7 11 L5.9 7.4 L2.3 6.3 L5.9 5.2 Z"
                    fill="currentColor"
                  />
                </svg>
              ) : (
                'У'
              )}
            </div>
            <div className="lv-ai-bubble">
              <div className="lv-ai-body">{m.body}</div>
              <div className="lv-ai-ts">{m.ts}</div>
            </div>
          </div>
        ))}
        {busy && (
          <div className="lv-ai-msg lv-ai-assistant">
            <div className="lv-ai-avatar">
              <svg viewBox="0 0 14 14" width="12" height="12">
                <path
                  d="M7 1.6 L8.1 5.2 L11.7 6.3 L8.1 7.4 L7 11 L5.9 7.4 L2.3 6.3 L5.9 5.2 Z"
                  fill="currentColor"
                />
              </svg>
            </div>
            <div className="lv-ai-bubble">
              <div className="lv-ai-typing">
                <i />
                <i />
                <i />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="lv-ai-suggest">
        {SUGGESTIONS.map((s) => (
          <button
            type="button"
            key={s.id}
            className="lv-ai-suggest-chip"
            onClick={() => void send(s.label)}
          >
            <span className="lv-ai-suggest-ico">{s.icon}</span>
            <span>{s.label}</span>
          </button>
        ))}
      </div>

      <div className="lv-ai-composer">
        <textarea
          ref={taRef}
          className="lv-ai-input"
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask about these logs… (Shift+Enter for newline)"
        />
        <div className="lv-ai-composer-foot">
          <span className="lv-ai-muted">
            <span className="lv-kbd">@</span> mention a file ·{' '}
            <span className="lv-kbd">/</span> commands
          </span>
          <button
            type="button"
            className="lv-ai-send"
            onClick={() => void send()}
            disabled={!input.trim() || busy}
            title="Send (Enter)"
          >
            <svg viewBox="0 0 14 14" width="12" height="12">
              <path
                d="M2 7 L12 2 L9 12 L7 8 Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinejoin="round"
              />
            </svg>
            <span>Send</span>
          </button>
        </div>
      </div>
    </aside>
  );
};
