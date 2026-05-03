import { LvMenuBar } from './LvMenuBar.tsx';
import type { LvMenuBarProps, LvRecentFile } from './LvMenuBar.tsx';

export interface LvTitlebarProps {
  onOpenCmd: () => void;
  onOpenFile?: LvMenuBarProps['onOpenFile'];
  onCommand?: LvMenuBarProps['onCommand'];
  readonly recentFiles?: ReadonlyArray<LvRecentFile>;
  onOpenRecent?: LvMenuBarProps['onOpenRecent'];
}

export const LvTitlebar = ({
  onOpenCmd,
  onOpenFile,
  onCommand,
  recentFiles,
  onOpenRecent,
}: LvTitlebarProps) => (
  <div className="lv-titlebar">
    <div className="lv-tb-left">
      <div className="lv-tb-dots">
        <span />
        <span />
        <span />
      </div>
      <LvMenuBar
        onOpenFile={onOpenFile}
        onCommand={onCommand}
        recentFiles={recentFiles}
        onOpenRecent={onOpenRecent}
      />
    </div>
    <button type="button" className="lv-tb-omni" onClick={onOpenCmd}>
      <svg viewBox="0 0 14 14" width="12" height="12">
        <circle cx="6" cy="6" r="4" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <path d="M9 9 L12 12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
      <span>Search files, lines, or run a command…</span>
      <span className="lv-kbd">⌘K</span>
    </button>
    <div className="lv-tb-right" />
  </div>
);
