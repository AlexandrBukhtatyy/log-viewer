import type { LogLevel } from '../../../core/types/index.ts';

export interface LvLevelPillProps {
  readonly level: LogLevel;
  readonly active: boolean;
  readonly count: number;
  onToggle: () => void;
}

export const LvLevelPill = ({
  level,
  active,
  count,
  onToggle,
}: LvLevelPillProps) => (
  <button
    type="button"
    className={`lv-lvl lv-lvl-${level}${active ? ' is-on' : ' is-off'}`}
    onClick={onToggle}
    aria-pressed={active}
  >
    <span className="lv-lvl-dot" />
    <span className="lv-lvl-name">{level}</span>
    <span className="lv-lvl-count">{count}</span>
  </button>
);
