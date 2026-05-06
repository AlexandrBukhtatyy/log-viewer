import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  GroupBucket,
  HistogramResponse,
} from '../../../core/rpc/coordinator.contract.ts';
import type {
  LogEntry,
  LogFilter,
  LogLevel,
} from '../../../core/types/index.ts';
import type {
  LvCatalogRoot,
  LvFileNode,
  LvGroupBy,
  LvRail,
  LvSavedSearch,
  LvSourceKind,
  LvTab,
  LvTweaks,
} from '../../contracts/lv-types.ts';
import { LvIconRail } from '../rail/LvIconRail.tsx';
import { LvSidebar } from '../sidebar/LvSidebar.tsx';
import { LvSidebarResizer } from './LvSidebarResizer.tsx';
import { LvTitlebar } from '../topbar/LvTitlebar.tsx';
import { LvViewer } from '../stream/LvViewer.tsx';
import { LvStatusBar } from '../status/LvStatusBar.tsx';
import { LvSearchPanel } from '../panels/LvSearchPanel.tsx';
import { LvBookmarksPanel } from '../panels/LvBookmarksPanel.tsx';
import { LvAiPanel } from '../panels/LvAiPanel.tsx';
import { LvAlertsPanel } from '../panels/LvAlertsPanel.tsx';
import { LvCommandPalette } from '../modals/LvCommandPalette.tsx';
import { LvShortcutsModal } from '../modals/LvShortcutsModal.tsx';
import {
  LvAddSourceModal,
  type LvAddSourceFormData,
} from '../sidebar/LvAddSourceModal.tsx';
import { LvSettingsPopover } from '../settings/LvSettingsPopover.tsx';
import { LvTweaksPanel } from '../tweaks/LvTweaksPanel.tsx';
import { LvTweakSection } from '../tweaks/LvTweakSection.tsx';
import { LvTweakRadio } from '../tweaks/LvTweakRadio.tsx';
import { LvTweakColor } from '../tweaks/LvTweakColor.tsx';
import { LvTweakToggle } from '../tweaks/LvTweakToggle.tsx';

type RenderDetailEditor = (props: {
  readonly value: string;
  readonly language: string;
  readonly theme: 'lv-dark' | 'lv-light';
  readonly wordWrap: boolean;
  readonly height: number;
}) => ReactNode;

export interface LvAppRecentFile {
  readonly id: string;
  readonly name: string;
  readonly path?: string;
}

export interface LvAppStatusStats {
  readonly files: number;
  readonly errors: number;
  readonly warns: number;
  readonly ingestingSources?: number;
  readonly ingestingEntries?: number;
}

export interface LvAppProps {
  // Adapted UI data — built by the container from useSourceStatus / useLogWindow.
  readonly catalog: ReadonlyArray<LvCatalogRoot>;
  readonly filesById: Readonly<Record<string, LvFileNode>>;

  // Windowed entry stream (from useLogWindow).
  readonly rowCount: number;
  readonly totalCount: number;
  getRow: (i: number) => LogEntry | undefined;
  onVisibleRangeChange: (from: number, to: number) => void;
  readonly levelCounts: Partial<Record<LogLevel, number>>;

  // Filter — single source of truth lives in the container (or its hook).
  readonly filter: LogFilter;
  setFilter: (next: (prev: LogFilter) => LogFilter) => void;

  // Sources / tree selection (UI state).
  readonly selectedIds: ReadonlySet<string>;
  setSelectedIds: (next: (prev: Set<string>) => Set<string>) => void;
  readonly activeTabId: string;
  setActiveTabId: (id: string) => void;
  readonly tabs: ReadonlyArray<LvTab>;
  setClosedTabs: (next: (prev: Set<string>) => Set<string>) => void;

  // Source-controller actions.
  onAddRoot: (sourceType: LvSourceKind) => void;
  onRemoveRoot: (id: string) => void;
  onOpenLocalFile?: () => Promise<void>;
  /**
   * Submit handler for the unified "Add log source" modal — currently
   * fires for the local-folder kind only.
   */
  onSubmitAddSource?: (data: LvAddSourceFormData) => void;
  /** Names of already-ingested sources — used to validate uniqueness in the modal. */
  readonly existingSourceNames?: ReadonlySet<string>;
  onGrantPermission?: (id: string) => void;
  onCancelSource?: (id: string) => void;

  // Tweaks / UI prefs (persisted in container via useUiPrefs).
  readonly tweaks: LvTweaks;
  setTweak: <K extends keyof LvTweaks>(key: K, value: LvTweaks[K]) => void;

  // Bookmarks (persisted via useBookmarks). `bookmarkEntries` carries the
  // resolved LogEntry for each bookmarked id where currently available.
  readonly bookmarks: ReadonlySet<string>;
  toggleBookmark: (id: string) => void;
  bookmarkKeyOf: (entry: LogEntry) => string;
  readonly bookmarkEntries: Readonly<Record<string, LogEntry>>;

  // Saved searches.
  readonly savedSearches: ReadonlyArray<LvSavedSearch>;
  onSaveSearch: () => void;

  // Recent files.
  readonly recentFiles: ReadonlyArray<LvAppRecentFile>;

  // Live tail (UI flag — actual streaming handled by stream-source adapter).
  readonly liveTail: boolean;
  onToggleLiveTail: () => void;

  // Group-by (UI state) + server-aggregated buckets (Phase 2).
  readonly groupBy: ReadonlyArray<LvGroupBy>;
  setGroupBy: (next: LvGroupBy[]) => void;
  readonly groupBuckets: ReadonlyArray<GroupBucket> | null;
  readonly groupField: string | null;
  onGroupDrillDown: (bucket: GroupBucket, field: string) => void;

  /** File menu → Export → JSONL/CSV; container wires `useExport`. */
  onExport?: (format: 'jsonl' | 'csv') => void;

  // Server-aggregated histogram (Phase 2).
  readonly histogramData: HistogramResponse;

  // Status bar stats (computed by container).
  readonly stats: LvAppStatusStats;

  // AI completion plug.
  onAiComplete?: (prompt: string) => Promise<string>;

  // Editor slot for LvRowDetail (Monaco; optional).
  renderDetailEditor?: RenderDetailEditor;
}

export const LvApp = ({
  catalog,
  filesById,
  rowCount,
  totalCount,
  getRow,
  onVisibleRangeChange,
  levelCounts,
  filter,
  setFilter,
  selectedIds,
  setSelectedIds,
  activeTabId,
  setActiveTabId,
  tabs,
  setClosedTabs,
  onAddRoot,
  onRemoveRoot,
  onOpenLocalFile,
  onSubmitAddSource,
  existingSourceNames,
  onGrantPermission,
  onCancelSource,
  tweaks,
  setTweak,
  bookmarks,
  toggleBookmark,
  bookmarkKeyOf,
  bookmarkEntries,
  savedSearches,
  onSaveSearch,
  recentFiles,
  liveTail,
  onToggleLiveTail,
  groupBy,
  setGroupBy,
  groupBuckets,
  groupField,
  onGroupDrillDown,
  onExport,
  histogramData,
  stats,
  onAiComplete,
  renderDetailEditor,
}: LvAppProps) => {
  // UI-only transient state (modals, side rail).
  const [rail, setRail] = useState<LvRail>('files');
  const [cmdOpen, setCmdOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [tweaksPanelOpen, setTweaksPanelOpen] = useState(false);
  const [addSourceModal, setAddSourceModal] = useState<
    { open: true; initialWatch: boolean } | { open: false }
  >({ open: false });
  // Live sidebar width during a drag — committed to persisted prefs on
  // mouseup. Initialised from `tweaks.sidebarWidth` so reload restores
  // the user's pick.
  const [sidebarWidth, setSidebarWidth] = useState<number>(
    tweaks.sidebarWidth ?? 260,
  );
  // VSCode-style collapse: hides the middle column entirely. Toggle with
  // Cmd/Ctrl+B or by clicking the currently-active rail icon.
  const [sidebarCollapsed, setSidebarCollapsedState] = useState<boolean>(
    tweaks.sidebarCollapsed ?? false,
  );
  // Mirror current value in a ref so the keydown listener (registered
  // once, see useEffect below) can read the latest state without stale
  // closures — and so toggleSidebar avoids running zustand setState
  // inside React's render phase.
  const collapsedRef = useRef(sidebarCollapsed);
  useEffect(() => {
    collapsedRef.current = sidebarCollapsed;
  }, [sidebarCollapsed]);
  const toggleSidebar = () => {
    const next = !collapsedRef.current;
    collapsedRef.current = next;
    setSidebarCollapsedState(next);
    setTweak('sidebarCollapsed', next);
  };
  const setSidebarCollapsed = (next: boolean) => {
    collapsedRef.current = next;
    setSidebarCollapsedState(next);
    setTweak('sidebarCollapsed', next);
  };
  // Mirror `rail` in a ref for the same reason as `collapsedRef`: the
  // keydown listener captures it once and we want it to stay current
  // without re-registering on every rail switch.
  const railRef = useRef(rail);
  useEffect(() => {
    railRef.current = rail;
  }, [rail]);
  /**
   * VSCode-style rail toggle: hitting the shortcut for the currently
   * visible panel collapses the sidebar; hitting any other rail shortcut
   * (or the same one while collapsed) expands and switches.
   */
  const triggerRail = (id: LvRail) => {
    if (collapsedRef.current) {
      setSidebarCollapsed(false);
      setRail(id);
      return;
    }
    if (id === railRef.current) {
      setSidebarCollapsed(true);
      return;
    }
    setRail(id);
  };

  useEffect(() => {
    document.documentElement.dataset.theme = tweaks.theme;
    document.documentElement.style.setProperty('--lv-accent', tweaks.accent);
  }, [tweaks.theme, tweaks.accent]);

  const lineCount = totalCount;

  const runCommand = (id: string) => {
    switch (id) {
      case 'toggle-live':
        onToggleLiveTail();
        break;
      case 'toggle-timeline':
        setTweak('timelineOn', !tweaks.timelineOn);
        break;
      case 'group-trace':
        setGroupBy(['trace_id']);
        break;
      case 'group-request':
        setGroupBy(['req_id']);
        break;
      case 'group-user':
        setGroupBy(['user_id']);
        break;
      case 'group-service':
        setGroupBy(['service']);
        break;
      case 'group-none':
        setGroupBy([]);
        break;
      case 'clear-filters':
        setFilter(() => ({
          query: '',
          queryMode: 'substring',
          caseSensitive: false,
          wholeWord: false,
          levels: null,
          services: null,
          timeRange: null,
          sources: null,
          filePaths: null,
          fieldFilters: [],
        }));
        break;
      case 'theme-toggle':
        setTweak('theme', tweaks.theme === 'dark' ? 'light' : 'dark');
        break;
      case 'density-toggle':
        setTweak('density', tweaks.density === 'compact' ? 'comfortable' : 'compact');
        break;
      case 'select-all':
        setSelectedIds(() => new Set(Object.keys(filesById)));
        break;
      case 'export-json':
      case 'export-ndjson':
        onExport?.('jsonl');
        break;
      case 'export-csv':
        onExport?.('csv');
        break;
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key === 'k') {
        e.preventDefault();
        setCmdOpen(true);
      }
      if (meta && !e.shiftKey && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        toggleSidebar();
      }
      // VSCode-style rail shortcuts: each maps to one panel. Collapses the
      // sidebar when the active panel's shortcut is pressed again.
      if (meta && e.shiftKey && (e.key === 'E' || e.key === 'e')) {
        e.preventDefault();
        triggerRail('files');
      }
      if (meta && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
        e.preventDefault();
        triggerRail('search');
      }
      if (meta && e.shiftKey && (e.key === 'B' || e.key === 'b')) {
        e.preventDefault();
        triggerRail('bookmarks');
      }
      if (meta && e.shiftKey && (e.key === 'A' || e.key === 'a')) {
        e.preventDefault();
        triggerRail('alerts');
      }
      if (meta && e.shiftKey && (e.key === 'L' || e.key === 'l')) {
        e.preventDefault();
        triggerRail('ai');
      }
      if (e.ctrlKey && e.altKey && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault();
        onToggleLiveTail();
      }
      if (e.ctrlKey && e.altKey && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        setTweak('theme', tweaks.theme === 'dark' ? 'light' : 'dark');
      }
      if (e.key === 'Escape') setCmdOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // toggleSidebar reads/writes via functional setState + a stable
    // zustand-backed setter, so it doesn't capture stale state — safe
    // to omit from deps and keep the listener registered once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tweaks.theme, setTweak, onToggleLiveTail]);

  const aiFileCount = selectedIds.size;
  const aiLineCount = lineCount;

  // For local-folder kinds we open the unified add-source modal; everything
  // else still goes through the legacy prompt-flow in the container.
  const handleAddRoot = (kind: LvSourceKind) => {
    if (kind === 'local-static') {
      setAddSourceModal({ open: true, initialWatch: false });
      return;
    }
    if (kind === 'local-live') {
      setAddSourceModal({ open: true, initialWatch: true });
      return;
    }
    onAddRoot(kind);
  };

  const leftPanel =
    rail === 'files' ? (
      <LvSidebar
        catalog={catalog}
        filesById={filesById}
        selectedIds={selectedIds}
        setSelectedIds={(updater) => setSelectedIds((prev) => updater(prev))}
        onAddRoot={handleAddRoot}
        onRemoveRoot={onRemoveRoot}
        onGrantPermission={onGrantPermission}
        onCancelSource={onCancelSource}
      />
    ) : rail === 'search' ? (
      <LvSearchPanel
        onRun={(q) => {
          setFilter((f) => ({ ...f, query: q }));
          setRail('files');
        }}
        savedSearches={savedSearches}
        onApplyPreset={(p) => {
          setFilter((f) => ({ ...f, query: p.query, levels: p.levels.length ? p.levels : null }));
          setRail('files');
        }}
      />
    ) : rail === 'bookmarks' ? (
      <LvBookmarksPanel
        bookmarks={bookmarks}
        allEntries={bookmarkEntries}
        filesById={filesById}
        onJump={(e) => {
          setSelectedIds((s) => {
            const n = new Set(s);
            n.add(e.sourceId);
            return n;
          });
          setActiveTabId(e.sourceId);
          setRail('files');
        }}
        onRemove={(id) => toggleBookmark(id)}
      />
    ) : rail === 'ai' ? (
      <LvAiPanel
        fileCount={aiFileCount}
        lineCount={aiLineCount}
        filters={filter}
        onComplete={onAiComplete}
        onRunFilter={(patch) => {
          setFilter((f) => ({ ...f, ...patch }));
          setRail('files');
        }}
        onJumpTo={(target) => {
          setSelectedIds((s) => {
            const n = new Set(s);
            n.add(target.sourceId);
            return n;
          });
          setActiveTabId(target.sourceId);
          setRail('files');
        }}
      />
    ) : (
      <LvAlertsPanel />
    );

  return (
    <div className="lv-root" data-theme={tweaks.theme} data-density={tweaks.density}>
      <LvTitlebar
        onOpenCmd={() => setCmdOpen(true)}
        onOpenFile={() => {
          if (onOpenLocalFile) void onOpenLocalFile();
        }}
        onCommand={(id) => {
          if (id === 'open-settings') {
            setSettingsOpen(true);
            return;
          }
          if (id === 'open-keys') {
            setShortcutsOpen(true);
            return;
          }
          if (id === 'open-cmd') {
            setCmdOpen(true);
            return;
          }
          runCommand(id);
        }}
        recentFiles={recentFiles}
        onOpenRecent={(r) => {
          setSelectedIds((s) => {
            const n = new Set(s);
            n.add(r.id);
            return n;
          });
          setActiveTabId(r.id);
          setRail('files');
        }}
      />
      <div
        className={`lv-main${sidebarCollapsed ? ' is-sidebar-collapsed' : ''}`}
        style={{ ['--lv-sidebar-width' as string]: `${sidebarWidth}px` }}
      >
        <LvIconRail
          active={rail}
          collapsed={sidebarCollapsed}
          onActivate={triggerRail}
          onOpenSettings={() => setSettingsOpen((v) => !v)}
          settingsOpen={settingsOpen}
        />
        {!sidebarCollapsed && leftPanel}
        {!sidebarCollapsed && (
          <LvSidebarResizer
            width={sidebarWidth}
            onResize={setSidebarWidth}
            onResizeEnd={(w) => setTweak('sidebarWidth', w)}
          />
        )}
        <LvViewer
          rowCount={rowCount}
          totalCount={totalCount}
          getRow={getRow}
          onVisibleRangeChange={onVisibleRangeChange}
          hasSources={selectedIds.size > 0}
          filesById={filesById}
          filter={filter}
          setFilter={setFilter}
          levelCounts={levelCounts}
          savedSearches={savedSearches}
          onSaveSearch={onSaveSearch}
          liveTail={liveTail}
          onToggleLiveTail={onToggleLiveTail}
          tabs={tabs}
          activeTabId={activeTabId}
          onActivateTab={setActiveTabId}
          onCloseTab={(id) =>
            setClosedTabs((s) => {
              const n = new Set(s);
              n.add(id);
              return n;
            })
          }
          bookmarks={bookmarks}
          onBookmark={toggleBookmark}
          bookmarkKeyOf={bookmarkKeyOf}
          tweaks={tweaks}
          timelineOn={tweaks.timelineOn}
          onToggleTimeline={() => setTweak('timelineOn', !tweaks.timelineOn)}
          groupBy={groupBy}
          setGroupBy={setGroupBy}
          histogramData={histogramData}
          groupBuckets={groupBuckets}
          groupField={groupField}
          onGroupDrillDown={onGroupDrillDown}
          renderDetailEditor={renderDetailEditor}
        />
      </div>
      <LvStatusBar stats={stats} liveTail={liveTail} theme={tweaks.theme} />

      {cmdOpen && <LvCommandPalette onClose={() => setCmdOpen(false)} onRun={runCommand} />}

      <LvSettingsPopover
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        tweaks={tweaks}
        setTweak={setTweak}
      />

      <LvShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      <LvAddSourceModal
        open={addSourceModal.open}
        initialWatch={addSourceModal.open ? addSourceModal.initialWatch : false}
        existingNames={existingSourceNames}
        onClose={() => setAddSourceModal({ open: false })}
        onSubmit={(data) => {
          onSubmitAddSource?.(data);
          setAddSourceModal({ open: false });
        }}
      />

      <LvTweaksPanel
        isOpen={tweaksPanelOpen}
        onClose={() => setTweaksPanelOpen(false)}
        title="Tweaks"
      >
        <LvTweakSection label="Appearance" />
        <LvTweakRadio
          label="Theme"
          value={tweaks.theme}
          options={['dark', 'light']}
          onChange={(v) => setTweak('theme', v)}
        />
        <LvTweakRadio
          label="Density"
          value={tweaks.density}
          options={['compact', 'comfortable']}
          onChange={(v) => setTweak('density', v)}
        />
        <LvTweakColor
          label="Accent"
          value={tweaks.accent}
          onChange={(v) => setTweak('accent', v)}
        />
        <LvTweakSection label="Display" />
        <LvTweakToggle
          label="Timeline chart"
          value={tweaks.timelineOn}
          onChange={(v) => setTweak('timelineOn', v)}
        />
        <LvTweakToggle
          label="Line wrap"
          value={tweaks.wrap}
          onChange={(v) => setTweak('wrap', v)}
        />
        <LvTweakToggle
          label="Show date column"
          value={tweaks.showDate}
          onChange={(v) => setTweak('showDate', v)}
        />
      </LvTweaksPanel>
    </div>
  );
};
