import type { LvTab } from '../../contracts/lv-types.ts';
import { LvFileIcon } from '../sidebar/LvFileIcon.tsx';

export interface LvTabsProps {
  readonly tabs: ReadonlyArray<LvTab>;
  readonly activeId: string;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  /**
   * Promote a preview tab to pinned. Fires on double-click of a
   * preview tab. `__all__` and already-pinned tabs ignore dbl-click.
   */
  onPin: (id: string) => void;
}

const isPreview = (t: LvTab): boolean => t.id !== '__all__' && !t.isPinned;

export const LvTabs = ({ tabs, activeId, onActivate, onClose, onPin }: LvTabsProps) => {
  if (!tabs.length) return null;
  return (
    <div className="lv-tabs">
      {tabs.map((t) => {
        const preview = isPreview(t);
        const className =
          `lv-tab${t.id === activeId ? ' is-active' : ''}${preview ? ' is-preview' : ''}`;
        return (
          <div
            key={t.id}
            className={className}
            onClick={() => onActivate(t.id)}
            onDoubleClick={() => {
              if (preview) onPin(t.id);
            }}
            title={t.path}
          >
            {t.id === '__all__' ? (
              <span className="lv-tab-all">
                <svg viewBox="0 0 10 10" width="10" height="10">
                  <rect x="1" y="1" width="3" height="3" fill="none" stroke="currentColor" strokeWidth="1" />
                  <rect x="6" y="1" width="3" height="3" fill="none" stroke="currentColor" strokeWidth="1" />
                  <rect x="1" y="6" width="3" height="3" fill="none" stroke="currentColor" strokeWidth="1" />
                  <rect x="6" y="6" width="3" height="3" fill="none" stroke="currentColor" strokeWidth="1" />
                </svg>
              </span>
            ) : (
              <LvFileIcon kind={t.kind ?? 'app'} />
            )}
            <span className="lv-tab-name">{t.name}</span>
            {t.id !== '__all__' && (
              <button
                type="button"
                className="lv-tab-x"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(t.id);
                }}
                aria-label="Close"
              >
                ✕
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
};
