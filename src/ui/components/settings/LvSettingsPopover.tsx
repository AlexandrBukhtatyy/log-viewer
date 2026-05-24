import type { LvTweaks } from '../../contracts/lv-types.ts';

export interface LvSettingsPopoverProps {
  readonly open: boolean;
  onClose: () => void;
  readonly tweaks: LvTweaks;
  setTweak: <K extends keyof LvTweaks>(key: K, value: LvTweaks[K]) => void;
}

export const LvSettingsPopover = ({
  open,
  onClose,
  tweaks,
  setTweak,
}: LvSettingsPopoverProps) => {
  if (!open) return null;
  return (
    <>
      <div className="lv-settings-scrim" onClick={onClose} />
      <div
        className="lv-settings-pop lv-settings-bottom-left"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="lv-settings-hd">
          <span>Settings</span>
          <button type="button" className="lv-settings-x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="lv-settings-sec">
          <div className="lv-settings-sec-hd">Appearance</div>

          <div className="lv-settings-row">
            <span className="lv-settings-label">Theme</span>
            <div className="lv-settings-seg">
              {(['dark', 'light'] as const).map((v) => (
                <button
                  type="button"
                  key={v}
                  className={`lv-settings-seg-btn${tweaks.theme === v ? ' is-on' : ''}`}
                  onClick={() => setTweak('theme', v)}
                >
                  {v === 'dark' ? (
                    <svg viewBox="0 0 14 14" width="12" height="12">
                      <path
                        d="M12 8.5 A5.5 5.5 0 1 1 5.5 2 A4.5 4.5 0 0 0 12 8.5 Z"
                        fill="currentColor"
                      />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 14 14" width="12" height="12">
                      <circle cx="7" cy="7" r="2.8" fill="currentColor" />
                      <path
                        d="M7 1 V2.3 M7 11.7 V13 M1 7 H2.3 M11.7 7 H13 M3 3 L3.9 3.9 M10.1 10.1 L11 11 M11 3 L10.1 3.9 M3.9 10.1 L3 11"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        strokeLinecap="round"
                      />
                    </svg>
                  )}
                  <span>{v === 'dark' ? 'Dark' : 'Light'}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="lv-settings-row">
            <span className="lv-settings-label">Density</span>
            <div className="lv-settings-seg">
              {(['compact', 'comfortable'] as const).map((v) => (
                <button
                  type="button"
                  key={v}
                  className={`lv-settings-seg-btn${tweaks.density === v ? ' is-on' : ''}`}
                  onClick={() => setTweak('density', v)}
                >
                  <span style={{ textTransform: 'capitalize' }}>{v}</span>
                </button>
              ))}
            </div>
          </div>

          <label className="lv-settings-check">
            <input
              type="checkbox"
              checked={tweaks.wrap}
              onChange={(e) => setTweak('wrap', e.target.checked)}
            />
            <span>Wrap long lines</span>
          </label>
          <label className="lv-settings-check">
            <input
              type="checkbox"
              checked={tweaks.showDate}
              onChange={(e) => setTweak('showDate', e.target.checked)}
            />
            <span>Show date column</span>
          </label>
          <label className="lv-settings-check">
            <input
              type="checkbox"
              checked={tweaks.timelineOn}
              onChange={(e) => setTweak('timelineOn', e.target.checked)}
            />
            <span>Show timeline</span>
          </label>
        </div>

        <div className="lv-settings-sec">
          <div className="lv-settings-sec-hd">Editor</div>
          <label className="lv-settings-check">
            <input type="checkbox" checked disabled />
            <span>Sync Monaco theme with viewer</span>
          </label>
        </div>

        <div className="lv-settings-sec">
          <div className="lv-settings-sec-hd">About</div>
          <div className="lv-settings-row">
            <span className="lv-settings-label">Version</span>
            <span>v{__APP_VERSION__}</span>
          </div>
          <div className="lv-settings-row">
            <span className="lv-settings-label">Build</span>
            <code>{__APP_BUILD_HASH__}</code>
          </div>
          <div className="lv-settings-row" style={{ flexWrap: 'wrap', gap: 10 }}>
            <a href="https://github.com/aleksandrbuhtatyj/log-viewer" target="_blank" rel="noopener">
              GitHub
            </a>
            <a
              href="https://github.com/aleksandrbuhtatyj/log-viewer/blob/main/CHANGELOG.md"
              target="_blank"
              rel="noopener"
            >
              Changelog
            </a>
            <a
              href="https://github.com/aleksandrbuhtatyj/log-viewer/blob/main/docs/ROADMAP.md"
              target="_blank"
              rel="noopener"
            >
              Roadmap
            </a>
            <a
              href="https://github.com/aleksandrbuhtatyj/log-viewer/issues"
              target="_blank"
              rel="noopener"
            >
              Issues
            </a>
          </div>
        </div>

        <div className="lv-settings-ft">
          <span className="lv-settings-muted">
            More options available in the developer Tweaks panel.
          </span>
        </div>
      </div>
    </>
  );
};
