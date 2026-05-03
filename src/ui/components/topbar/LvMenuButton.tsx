import { LvMenu } from './LvMenu.tsx';
import type { LvMenuItem, LvMenuRunHandler } from './LvMenu.tsx';

export interface LvMenuButtonProps {
  readonly label: string;
  readonly open: boolean;
  onHover: () => void;
  onToggle: () => void;
  readonly items: ReadonlyArray<LvMenuItem>;
  onRun: LvMenuRunHandler;
}

export const LvMenuButton = ({
  label,
  open,
  onHover,
  onToggle,
  items,
  onRun,
}: LvMenuButtonProps) => (
  <div className={`lv-mb-wrap${open ? ' is-open' : ''}`}>
    <button
      type="button"
      className={`lv-mb-btn${open ? ' is-on' : ''}`}
      onClick={onToggle}
      onMouseEnter={onHover}
    >
      {label}
    </button>
    {open && <LvMenu items={items} onRun={onRun} />}
  </div>
);
