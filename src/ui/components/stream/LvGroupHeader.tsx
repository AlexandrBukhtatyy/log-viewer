import type { GroupBucket } from '../../../core/rpc/coordinator.contract.ts';
import type { LogLevel } from '../../../core/types/index.ts';

const LEVELS: LogLevel[] = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'unknown',
];

export interface LvGroupHeaderProps {
  readonly bucket: GroupBucket;
  readonly field: string;
  readonly depth?: number;
  readonly expanded?: boolean;
  onToggle?: () => void;
  onFocus: () => void;
  onCopy: () => void;
}

export const LvGroupHeader = ({
  bucket,
  field,
  depth = 0,
  expanded = false,
  onToggle,
  onFocus,
  onCopy,
}: LvGroupHeaderProps) => {
  const { value, count, tsMin, tsMax, levelCounts } = bucket;
  const dur = tsMin !== null && tsMax !== null ? Math.max(0, tsMax - tsMin) : 0;
  const durStr = dur < 1000 ? `${dur}ms` : `${(dur / 1000).toFixed(2)}s`;
  const labelKey = value ?? '∅';
  const hasError = (levelCounts.error ?? 0) > 0 || (levelCounts.fatal ?? 0) > 0;

  return (
    <div
      className={`lv-grp lv-grp-d${depth}${expanded ? ' is-expanded' : ''}${hasError ? ' has-error' : ''}`}
      onClick={onToggle}
      style={{ paddingLeft: 12 + depth * 16 }}
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
        <span className="lv-grp-key" title={labelKey}>
          {labelKey}
        </span>
      </span>
      <span className="lv-grp-mix">
        {LEVELS.map((l) =>
          levelCounts[l] ? (
            <span
              key={l}
              className={`lv-grp-dot lv-level-tag-${l}`}
              title={`${levelCounts[l]} ${l}`}
            >
              <i />
              <span>{levelCounts[l]}</span>
            </span>
          ) : null,
        )}
      </span>
      <span className="lv-grp-meta">
        <span className="lv-grp-count">{count} lines</span>
        {dur > 0 && (
          <>
            <span className="lv-grp-sep">·</span>
            <span>{durStr}</span>
          </>
        )}
      </span>
      <span className="lv-grp-actions" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="lv-row-open"
          onClick={onFocus}
          title="Focus this group only"
        >
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
        <button
          type="button"
          className="lv-row-open"
          onClick={onCopy}
          title="Copy key"
        >
          <svg viewBox="0 0 12 12" width="12" height="12">
            <rect
              x="2"
              y="3"
              width="6"
              height="7"
              rx="1"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.1"
            />
            <path
              d="M4 2 H9 A1 1 0 0 1 10 3 V8"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.1"
            />
          </svg>
        </button>
      </span>
    </div>
  );
};
