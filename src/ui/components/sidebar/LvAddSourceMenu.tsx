import { useEffect, useRef, useState } from 'react';
import type { LvSourceKind } from '../../contracts/lv-types.ts';
import { LvSourceIcon } from './LvSourceIcon.tsx';

interface SourceItem {
  id: LvSourceKind;
  label: string;
  hint?: string;
  desc: string;
}

const SOURCES: SourceItem[] = [
  { id: 'local-static', label: 'Local folder…', hint: '⇧⌘O', desc: 'Pick a directory of log files' },
  { id: 'local-live', label: 'Watch folder…', desc: 'Tail files as they grow' },
  { id: 'remote-ssh', label: 'SSH remote…', desc: 'Connect to a host over SSH' },
  { id: 'stream', label: 'Attach stream…', desc: 'kubectl logs ‑f, docker logs, journalctl' },
  { id: 'cloud', label: 'Cloud provider…', desc: 'Datadog, CloudWatch, GCP Logging' },
  { id: 'k8s', label: 'Kubernetes cluster…', desc: 'Pods, namespaces, deployments' },
  { id: 'bus', label: 'Message bus…', desc: 'Kafka, NATS, Redis Streams' },
  { id: 'db', label: 'Database query…', desc: 'Loki, ClickHouse, BigQuery' },
  { id: 'snapshot', label: 'Open snapshot…', hint: '⌘O', desc: '.zip / .tar.gz of log files' },
];

export interface LvAddSourceMenuProps {
  onPick: (id: LvSourceKind) => void;
  readonly variant?: 'split' | 'compact';
  readonly primaryLabel?: string;
}

export const LvAddSourceMenu = ({
  onPick,
  variant = 'split',
  primaryLabel = 'Add source',
}: LvAddSourceMenuProps) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const pick = (id: LvSourceKind) => {
    setOpen(false);
    onPick(id);
  };

  return (
    <div className={`lv-add-src lv-add-src-${variant}`} ref={wrapRef}>
      {variant === 'split' ? (
        <div className="lv-add-src-split">
          <button
            type="button"
            className="lv-add-src-main"
            onClick={() => pick('local-static')}
            title="Add local folder"
          >
            <span className="lv-add-src-plus" aria-hidden="true">＋</span>
            <span>{primaryLabel}</span>
          </button>
          <button
            type="button"
            className={`lv-add-src-caret${open ? ' is-on' : ''}`}
            onClick={() => setOpen((v) => !v)}
            aria-label="More source types"
            title="More source types"
          >
            <svg viewBox="0 0 8 8" width="8" height="8" aria-hidden="true">
              <path
                d="M1.5 3 L4 5.5 L6.5 3"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={`lv-add-src-compact${open ? ' is-on' : ''}`}
          onClick={() => setOpen((v) => !v)}
          title="Add source"
        >
          <span className="lv-add-src-plus" aria-hidden="true">＋</span>
          <span>{primaryLabel}</span>
          <svg viewBox="0 0 8 8" width="8" height="8" aria-hidden="true">
            <path
              d="M1.5 3 L4 5.5 L6.5 3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
      {open && (
        <div className="lv-add-src-menu" role="menu">
          <div className="lv-add-src-hd">Add source</div>
          {SOURCES.map((s) => (
            <button
              key={s.id}
              type="button"
              className="lv-add-src-item"
              onClick={() => pick(s.id)}
              role="menuitem"
            >
              <span className={`lv-folder-ico lv-src lv-src-${s.id}`} aria-hidden="true">
                <LvSourceIcon source={s.id} />
              </span>
              <span className="lv-add-src-item-body">
                <span className="lv-add-src-item-label">{s.label}</span>
                <span className="lv-add-src-item-desc">{s.desc}</span>
              </span>
              {s.hint && <span className="lv-add-src-item-hint">{s.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
