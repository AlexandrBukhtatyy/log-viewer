import { useState } from 'react';

export type LvMenuRunHandler = (action?: () => void) => void;

export interface LvMenuItem {
  readonly id?: string;
  readonly kind?: 'sep';
  readonly label?: string;
  readonly hint?: string;
  readonly disabled?: boolean;
  readonly onRun?: () => void;
  readonly submenu?: ReadonlyArray<LvMenuItem>;
}

export interface LvMenuProps {
  readonly items: ReadonlyArray<LvMenuItem>;
  readonly nested?: boolean;
  onRun: LvMenuRunHandler;
}

export const LvMenu = ({ items, onRun, nested = false }: LvMenuProps) => {
  const [subOpen, setSubOpen] = useState<string | null>(null);
  return (
    <div className={`lv-menu${nested ? ' is-nested' : ''}`}>
      {items.map((it, i) => {
        if (it.kind === 'sep') return <div key={`s:${i}`} className="lv-menu-sep" />;
        const hasSub = !!(it.submenu && it.submenu.length > 0);
        const isSubOpen = subOpen === it.id;
        return (
          <div
            key={it.id ?? `i:${i}`}
            className={
              `lv-menu-item${it.disabled ? ' is-disabled' : ''}` +
              `${hasSub ? ' has-sub' : ''}` +
              `${isSubOpen ? ' is-sub-open' : ''}`
            }
            onMouseEnter={() => setSubOpen(hasSub ? (it.id ?? null) : null)}
            onClick={(e) => {
              if (it.disabled) return;
              if (hasSub) {
                e.stopPropagation();
                setSubOpen((v) => (v === it.id ? null : (it.id ?? null)));
                return;
              }
              onRun(it.onRun);
            }}
          >
            <span className="lv-menu-check" />
            <span className="lv-menu-label">{it.label}</span>
            {hasSub ? (
              <span className="lv-menu-caret">
                <svg viewBox="0 0 8 8" width="8" height="8">
                  <path
                    d="M3 1.5 L5.5 4 L3 6.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            ) : it.hint ? (
              <span className="lv-menu-hint">{it.hint}</span>
            ) : (
              <span />
            )}
            {hasSub && isSubOpen && it.submenu && (
              <div className="lv-menu-sub">
                <LvMenu items={it.submenu} onRun={onRun} nested />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
