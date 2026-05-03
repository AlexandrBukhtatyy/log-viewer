import type { LvGroup, LvLogLevel } from '../../contracts/lv-types.ts';

const LEVELS: LvLogLevel[] = ['error', 'warn', 'info', 'debug', 'trace'];

export interface LvGroupHeaderProps {
  readonly group: LvGroup;
  readonly expanded: boolean;
  onToggle: () => void;
  onFocus: () => void;
  onCopy: () => void;
}

export const LvGroupHeader = ({
  group,
  expanded,
  onToggle,
  onFocus,
  onCopy,
}: LvGroupHeaderProps) => {
  const { key, entries, minTs, maxTs, levels, depth, field } = group;
  const dur = Math.max(0, maxTs - minTs);
  const durStr = dur < 1000 ? `${dur}ms` : `${(dur / 1000).toFixed(2)}s`;
  const allServices = new Set(entries.map((e) => e.service));
  const services = Array.from(allServices).slice(0, 3);
  const files = new Set(entries.map((e) => e.fileId)).size;
  const topMsg = (entries.find((e) => e.level === 'error') ?? entries[0])?.msg ?? '';

  return (
    <div
      className={`lv-grp lv-grp-d${depth || 0}${expanded ? ' is-expanded' : ''}${levels.error ? ' has-error' : ''}`}
      onClick={onToggle}
      style={{ paddingLeft: 12 + (depth || 0) * 16 }}
    >
      <span className="lv-grp-caret">
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
      <span className="lv-grp-label">
        <span className="lv-grp-by">{field}</span>
        <span className="lv-grp-key" title={key}>
          {key}
        </span>
      </span>
      <span className="lv-grp-mix">
        {LEVELS.map((l) =>
          levels[l] ? (
            <span
              key={l}
              className={`lv-grp-dot lv-level-tag-${l}`}
              title={`${levels[l]} ${l}`}
            >
              <i />
              <span>{levels[l]}</span>
            </span>
          ) : null,
        )}
      </span>
      <span className="lv-grp-svc">
        {services.join(', ')}
        {services.length < allServices.size ? '…' : ''}
      </span>
      <span className="lv-grp-meta">
        <span className="lv-grp-count">{entries.length} lines</span>
        <span className="lv-grp-sep">·</span>
        <span>
          {files} file{files !== 1 ? 's' : ''}
        </span>
        <span className="lv-grp-sep">·</span>
        <span>{durStr}</span>
      </span>
      <span className="lv-grp-preview" title={topMsg}>
        {topMsg}
      </span>
      <span className="lv-grp-actions" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="lv-row-open" onClick={onFocus} title="Focus this group only">
          <svg viewBox="0 0 12 12" width="12" height="12">
            <path
              d="M3 3 H9 V9 H3 Z M5 5 H7 V7 H5 Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.1"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button type="button" className="lv-row-open" onClick={onCopy} title="Copy key">
          <svg viewBox="0 0 12 12" width="12" height="12">
            <rect x="2" y="3" width="6" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="1.1" />
            <path d="M4 2 H9 A1 1 0 0 1 10 3 V8" fill="none" stroke="currentColor" strokeWidth="1.1" />
          </svg>
        </button>
      </span>
    </div>
  );
};
