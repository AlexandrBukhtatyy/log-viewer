import { useEffect, useRef } from 'react';
import type { LogEntry } from '../../../core/types/index.ts';
import type { LvFileNode } from '../../contracts/lv-types.ts';
import { lvHighlight } from '../../utils/lv-highlight.tsx';
import { LvFileIcon } from '../sidebar/LvFileIcon.tsx';

export interface LvFilePeekProps {
  readonly file: LvFileNode;
  readonly entries: ReadonlyArray<LogEntry>;
  readonly line: number;
  onClose: () => void;
  readonly query: string;
  readonly useRegex: boolean;
  readonly caseSensitive: boolean;
  readonly wholeWord: boolean;
}

export const LvFilePeek = ({
  file,
  entries,
  line,
  onClose,
  query,
  useRegex,
  caseSensitive,
  wholeWord,
}: LvFilePeekProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = containerRef.current?.querySelector(`[data-line="${line}"]`);
    if (el) el.scrollIntoView({ block: 'center' });
  }, [line]);
  return (
    <div className="lv-peek">
      <div className="lv-peek-hd">
        <span className="lv-peek-title">
          <LvFileIcon kind={file.kind} />
          <span>{file.name}</span>
          <span className="lv-peek-line">:{line}</span>
        </span>
        <span className="lv-peek-path">
          {file.path ?? `/var/log/${file.name}`}
        </span>
        <button
          type="button"
          className="lv-peek-close"
          onClick={onClose}
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      <div className="lv-peek-body" ref={containerRef}>
        {entries.map((e) => (
          <div
            key={e.id}
            data-line={e.seq}
            className={`lv-peek-row lv-level-${e.level}${e.seq === line ? ' is-focus' : ''}`}
          >
            <span className="lv-peek-ln">{e.seq}</span>
            <span className="lv-peek-content">
              {lvHighlight(e.raw, query, useRegex, caseSensitive, wholeWord)}
            </span>
          </div>
        ))}
      </div>
      <div className="lv-peek-ft">
        <span>{entries.length.toLocaleString()} lines</span>
        <span className="lv-peek-kbd">
          <span className="lv-kbd">Esc</span> close
        </span>
      </div>
    </div>
  );
};
