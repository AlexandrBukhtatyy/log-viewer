import { useEffect, useState } from 'react';

export interface LvClearDataScope {
  /** Worker-side: SQLite index, OPFS spool, FS handle store, custom parsers. */
  readonly indexData: boolean;
  /** Main-thread UI state: bookmarks, saved searches, recent files, prefs. */
  readonly uiState: boolean;
  /** PWA service-worker precache + registration. */
  readonly pwaCache: boolean;
}

export interface LvClearDataModalProps {
  readonly open: boolean;
  onClose: () => void;
  /**
   * Runs the actual clear. The modal closes immediately on Confirm
   * without awaiting this promise — the container is responsible for
   * any follow-up navigation (e.g. `location.reload()` when PWA cache
   * or UI state was selected). Errors should be logged by the caller.
   */
  onConfirm: (scope: LvClearDataScope) => Promise<void>;
}

const DEFAULT_SCOPE: LvClearDataScope = {
  indexData: true,
  uiState: false,
  pwaCache: false,
};

export const LvClearDataModal = ({
  open,
  onClose,
  onConfirm,
}: LvClearDataModalProps) => {
  const [scope, setScope] = useState<LvClearDataScope>(DEFAULT_SCOPE);

  // The parent is expected to unmount the modal between sessions (via
  // `{clearDataOpen && <LvClearDataModal …>}`) so we don't carry stale
  // checkbox state across opens — no manual reset effect is needed.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const anySelected = scope.indexData || scope.uiState || scope.pwaCache;

  // Close the modal immediately and run the actual work in the background.
  // Worker-side `clearAll` already emits an empty status snapshot within
  // milliseconds (see coordinator.ts), so the sidebar visibly empties
  // right away even though the deep cleanup (ingest drain, SQLite DELETE,
  // OPFS recursive remove) keeps running. For pwaCache/uiState scopes the
  // background task triggers `location.reload()` when done — no need to
  // hold the modal open to wait for it.
  const handleConfirm = (): void => {
    if (!anySelected) return;
    void onConfirm(scope).catch((err: unknown) => {
      console.warn('[clear-data] background task failed', err);
    });
    onClose();
  };

  const toggle = <K extends keyof LvClearDataScope>(key: K): void => {
    setScope((s) => ({ ...s, [key]: !s[key] }));
  };

  return (
    <>
      <div className="lv-modal-scrim" onClick={onClose} />
      <div
        className="lv-modal lv-clear-data-modal"
        role="dialog"
        aria-label="Clear application data"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="lv-modal-hd">
          <span>Clear application data</span>
          <button
            type="button"
            className="lv-modal-x"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="lv-modal-body">
          <p className="lv-settings-muted" style={{ marginTop: 0 }}>
            Select what to wipe. This action cannot be undone.
          </p>
          <label className="lv-clear-row">
            <input
              type="checkbox"
              checked={scope.indexData}
              onChange={() => toggle('indexData')}
            />
            <span>
              <span className="lv-clear-row-title">
                Indexed data &amp; sources
              </span>
              <span className="lv-clear-row-sub">
                SQLite index, OPFS body cache, file-handle registry, custom
                parsers.
              </span>
            </span>
          </label>
          <label className="lv-clear-row">
            <input
              type="checkbox"
              checked={scope.uiState}
              onChange={() => toggle('uiState')}
            />
            <span>
              <span className="lv-clear-row-title">UI state</span>
              <span className="lv-clear-row-sub">
                Bookmarks, saved searches, recent files, layout &amp; theme
                prefs.
              </span>
            </span>
          </label>
          <label className="lv-clear-row">
            <input
              type="checkbox"
              checked={scope.pwaCache}
              onChange={() => toggle('pwaCache')}
            />
            <span>
              <span className="lv-clear-row-title">PWA cache</span>
              <span className="lv-clear-row-sub">
                Service-worker precache and registration. The page will reload.
              </span>
            </span>
          </label>
        </div>
        <div className="lv-modal-ft lv-modal-ft-actions">
          <button type="button" className="lv-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="lv-btn lv-btn-danger"
            onClick={handleConfirm}
            disabled={!anySelected}
          >
            Clear selected
          </button>
        </div>
      </div>
    </>
  );
};
