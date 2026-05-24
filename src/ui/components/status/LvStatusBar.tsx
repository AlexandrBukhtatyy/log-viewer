import type { LvTweakTheme } from '../../contracts/lv-types.ts';

export interface LvStatusBarStats {
  readonly files: number;
  readonly errors: number;
  readonly warns: number;
  /** Sources currently ingesting (loading/indexing/streaming). 0 = idle. */
  readonly ingestingSources?: number;
  /** Sum of `entriesIndexed` across all currently-ingesting sources. */
  readonly ingestingEntries?: number;
}

export interface LvStatusBarProps {
  readonly stats: LvStatusBarStats;
  readonly liveTail: boolean;
  readonly theme: LvTweakTheme;
  readonly onOpenAbout?: () => void;
}

export const LvStatusBar = ({ stats, liveTail, theme, onOpenAbout }: LvStatusBarProps) => {
  const ingesting = stats.ingestingSources ?? 0;
  const ingested = stats.ingestingEntries ?? 0;
  return (
  <div className="lv-status">
    {onOpenAbout ? (
      <button
        type="button"
        className="lv-status-item lv-status-app lv-status-app-btn"
        onClick={onOpenAbout}
        title="About Log Viewer"
      >
        <span className="lv-status-app-name">Log Viewer</span>
        <span className="lv-status-app-ver">v{__APP_VERSION__} · PWA</span>
      </button>
    ) : (
      <span className="lv-status-item lv-status-app">
        <span className="lv-status-app-name">Log Viewer</span>
        <span className="lv-status-app-ver">v{__APP_VERSION__} · PWA</span>
      </span>
    )}

    <div style={{ flex: 1 }} />

    {ingesting > 0 && (
      <>
        <span
          className="lv-status-item lv-status-ingest"
          title={`${ingesting} source${ingesting !== 1 ? 's' : ''} ingesting`}
        >
          <span className="lv-spinner" aria-hidden="true" />
          <span>
            indexing
            {ingested > 0 ? ` · ${ingested.toLocaleString()} entries` : '…'}
          </span>
        </span>
        <span className="lv-status-sep" />
      </>
    )}

    {liveTail && (
      <>
        <span className="lv-status-item">
          <span className="lv-live-dot is-on" />
          <span>Live</span>
        </span>
        <span className="lv-status-sep" />
      </>
    )}
    <span className="lv-status-item">
      <span className="lv-status-ico">
        <svg viewBox="0 0 14 10" width="14" height="10">
          <path
            d="M1 9 L4 4 L7 6 L10 1 L13 5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span>
        {stats.files} file{stats.files !== 1 ? 's' : ''}
      </span>
    </span>
    <span className="lv-status-sep" />
    <span className="lv-status-item lv-level-error" style={{ color: 'var(--lv-level-error)' }}>
      {stats.errors} errors
    </span>
    <span className="lv-status-item lv-level-warn" style={{ color: 'var(--lv-level-warn)' }}>
      {stats.warns} warnings
    </span>
    <span className="lv-status-sep" />
    <span className="lv-status-item">UTC</span>
    <span className="lv-status-sep" />
    <span className="lv-status-item">{theme === 'dark' ? 'Dark' : 'Light'}</span>
  </div>
  );
};
