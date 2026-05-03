import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  LvCatalogRoot,
  LvFileNode,
  LvFilters,
  LvGroupBy,
  LvLogEntry,
  LvLogLevel,
  LvRail,
  LvSavedSearch,
  LvSourceKind,
  LvTweaks,
} from '../../contracts/lv-types.ts';
import { lvApplyFilters } from '../../utils/lv-filter.ts';
import { LvIconRail } from '../rail/LvIconRail.tsx';
import { LvSidebar } from '../sidebar/LvSidebar.tsx';
import { LvTitlebar } from '../topbar/LvTitlebar.tsx';
import { LvViewer } from '../stream/LvViewer.tsx';
import { LvStatusBar } from '../status/LvStatusBar.tsx';
import { LvSearchPanel } from '../panels/LvSearchPanel.tsx';
import { LvBookmarksPanel } from '../panels/LvBookmarksPanel.tsx';
import { LvAiPanel } from '../panels/LvAiPanel.tsx';
import { LvAlertsPanel } from '../panels/LvAlertsPanel.tsx';
import { LvCommandPalette } from '../modals/LvCommandPalette.tsx';
import { LvShortcutsModal } from '../modals/LvShortcutsModal.tsx';
import { LvSettingsPopover } from '../settings/LvSettingsPopover.tsx';
import { LvTweaksPanel } from '../tweaks/LvTweaksPanel.tsx';
import { LvTweakSection } from '../tweaks/LvTweakSection.tsx';
import { LvTweakRadio } from '../tweaks/LvTweakRadio.tsx';
import { LvTweakColor } from '../tweaks/LvTweakColor.tsx';
import { LvTweakToggle } from '../tweaks/LvTweakToggle.tsx';

const TWEAK_DEFAULTS: LvTweaks = {
  theme: 'dark',
  density: 'compact',
  wrap: false,
  showDate: false,
  accent: '#7aa2f7',
  timelineOn: true,
};

const FILTER_DEFAULTS: LvFilters = {
  query: '',
  useRegex: false,
  caseSensitive: false,
  wholeWord: false,
  levels: new Set<LvLogLevel>(['error', 'warn', 'info', 'debug']),
  services: new Set<string>(),
  timeRange: null,
  fieldFilters: [],
};

export interface LvAppProps {
  readonly catalog: ReadonlyArray<LvCatalogRoot>;
  readonly filesById: Readonly<Record<string, LvFileNode>>;
  readonly logsByFile: Readonly<Record<string, ReadonlyArray<LvLogEntry>>>;
  readonly savedSearches: ReadonlyArray<LvSavedSearch>;
  onAddRoot: (sourceType: LvSourceKind) => void;
  onRemoveRoot: (id: string) => void;
  onOpenLocalFile?: () => Promise<void>;
  onAiComplete?: (prompt: string) => Promise<string>;
  readonly initialSelectedIds?: ReadonlyArray<string>;
  readonly tweaksPanelOpen?: boolean;
  onCloseTweaks?: () => void;
  renderDetailEditor?: (props: {
    readonly value: string;
    readonly language: string;
    readonly theme: 'lv-dark' | 'lv-light';
    readonly wordWrap: boolean;
    readonly height: number;
  }) => ReactNode;
}

export const LvApp = ({
  catalog,
  filesById,
  logsByFile,
  savedSearches: savedSearchesIn,
  onAddRoot,
  onRemoveRoot,
  onOpenLocalFile,
  onAiComplete,
  initialSelectedIds,
  tweaksPanelOpen = false,
  onCloseTweaks,
  renderDetailEditor,
}: LvAppProps) => {
  const [tweaks, setTweaks] = useState<LvTweaks>(TWEAK_DEFAULTS);
  const setTweak = <K extends keyof LvTweaks>(key: K, value: LvTweaks[K]) => {
    setTweaks((prev) => ({ ...prev, [key]: value }));
  };

  useEffect(() => {
    document.documentElement.dataset.theme = tweaks.theme;
    document.documentElement.style.setProperty('--lv-accent', tweaks.accent);
  }, [tweaks.theme, tweaks.accent]);

  const [rail, setRail] = useState<LvRail>('files');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(initialSelectedIds ?? []),
  );
  const [filters, setFilters] = useState<LvFilters>(() => ({
    ...FILTER_DEFAULTS,
    levels: new Set(FILTER_DEFAULTS.levels),
  }));
  const [savedSearches, setSavedSearches] =
    useState<LvSavedSearch[]>(() => [...savedSearchesIn]);
  const [liveTail, setLiveTail] = useState(false);
  const [activeTabId, setActiveTabId] = useState('__all__');
  const [closedTabs, setClosedTabs] = useState<Set<string>>(() => new Set());
  const [bookmarks, setBookmarks] = useState<Set<string>>(() => new Set());
  const [cmdOpen, setCmdOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [groupBy, setGroupBy] = useState<LvGroupBy[]>([]);

  const recentFiles = useMemo(() => {
    return Array.from(selectedIds)
      .map((id) => filesById[id])
      .filter((f): f is LvFileNode => !!f)
      .slice(0, 5)
      .map((f) => ({ id: f.id, name: f.name, path: f.path }));
  }, [selectedIds, filesById]);

  const tabs = useMemo(() => {
    const t: { id: string; name: string; path?: string; kind?: LvFileNode['kind'] }[] = [
      { id: '__all__', name: `All selected (${selectedIds.size})`, path: '', kind: 'app' },
    ];
    Array.from(selectedIds).forEach((id) => {
      const f = filesById[id];
      if (!f || closedTabs.has(id)) return;
      t.push({ id: f.id, name: f.name, path: `/var/log/${f.name}`, kind: f.kind });
    });
    return t;
  }, [selectedIds, closedTabs, filesById]);

  const effectiveActiveTabId = useMemo(() => {
    if (activeTabId === '__all__') return activeTabId;
    if (!selectedIds.has(activeTabId) || closedTabs.has(activeTabId)) return '__all__';
    return activeTabId;
  }, [activeTabId, selectedIds, closedTabs]);

  const allEntries = useMemo<Record<string, LvLogEntry>>(() => {
    const m: Record<string, LvLogEntry> = {};
    for (const arr of Object.values(logsByFile)) {
      for (const e of arr) m[e.id] = e;
    }
    return m;
  }, [logsByFile]);

  const stats = useMemo(() => {
    let errors = 0;
    let warns = 0;
    let combined: LvLogEntry[] = [];
    for (const id of selectedIds) {
      const arr = logsByFile[id] ?? [];
      combined = combined.concat(arr as LvLogEntry[]);
      for (const e of arr) {
        if (e.level === 'error') errors++;
        else if (e.level === 'warn') warns++;
      }
    }
    const result = lvApplyFilters(combined, filters).length;
    return { total: combined.length, errors, warns, result, files: selectedIds.size };
  }, [selectedIds, filters, logsByFile]);

  const onBookmark = (id: string) =>
    setBookmarks((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const onSaveSearch = () => {
    const name = `Custom ${savedSearches.length + 1}`;
    const q = filters.query || '(no query)';
    setSavedSearches((s) => [
      ...s,
      {
        id: `custom-${Date.now()}`,
        name,
        query: q,
        levels: Array.from(filters.levels) as LvLogLevel[],
      },
    ]);
  };

  const runCommand = (id: string) => {
    switch (id) {
      case 'toggle-live':
        setLiveTail((v) => !v);
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
        setFilters({ ...FILTER_DEFAULTS, levels: new Set(FILTER_DEFAULTS.levels) });
        break;
      case 'theme-toggle':
        setTweak('theme', tweaks.theme === 'dark' ? 'light' : 'dark');
        break;
      case 'density-toggle':
        setTweak('density', tweaks.density === 'compact' ? 'comfortable' : 'compact');
        break;
      case 'select-all':
        setSelectedIds(new Set(Object.keys(filesById)));
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
      if (meta && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
        e.preventDefault();
        setRail('search');
      }
      if (e.ctrlKey && e.altKey && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault();
        setLiveTail((v) => !v);
      }
      if (e.ctrlKey && e.altKey && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        setTweak('theme', tweaks.theme === 'dark' ? 'light' : 'dark');
      }
      if (e.key === 'Escape') setCmdOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tweaks.theme]);

  const lineCount = Object.values(logsByFile)
    .filter((_, i) => Array.from(selectedIds)[i] !== undefined)
    .reduce((s, arr) => s + arr.length, 0);

  const aiFileCount = selectedIds.size;
  const aiLineCount = Array.from(selectedIds).reduce(
    (s, id) => s + (logsByFile[id]?.length ?? 0),
    0,
  );
  void lineCount;

  const leftPanel =
    rail === 'files' ? (
      <LvSidebar
        catalog={catalog}
        filesById={filesById}
        selectedIds={selectedIds}
        setSelectedIds={(updater) => setSelectedIds((prev) => updater(prev))}
        onAddRoot={onAddRoot}
        onRemoveRoot={onRemoveRoot}
      />
    ) : rail === 'search' ? (
      <LvSearchPanel
        onRun={(q) => {
          setFilters((f) => ({ ...f, query: q }));
          setRail('files');
        }}
        savedSearches={savedSearches}
        onApplyPreset={(p) => {
          setFilters((f) => ({ ...f, query: p.query, levels: new Set(p.levels) }));
          setRail('files');
        }}
      />
    ) : rail === 'bookmarks' ? (
      <LvBookmarksPanel
        bookmarks={bookmarks}
        allEntries={allEntries}
        onJump={(e) => {
          setSelectedIds((s) => {
            const n = new Set(s);
            n.add(e.fileId);
            return n;
          });
          setActiveTabId(e.fileId);
          setRail('files');
        }}
        onRemove={(id) =>
          setBookmarks((s) => {
            const n = new Set(s);
            n.delete(id);
            return n;
          })
        }
      />
    ) : rail === 'ai' ? (
      <LvAiPanel
        fileCount={aiFileCount}
        lineCount={aiLineCount}
        filters={filters}
        onComplete={onAiComplete}
        onRunFilter={(patch) => {
          setFilters((f) => ({ ...f, ...patch }));
          setRail('files');
        }}
        onJumpTo={(target) => {
          setSelectedIds((s) => {
            const n = new Set(s);
            n.add(target.fileId);
            return n;
          });
          setActiveTabId(target.fileId);
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
      <div className="lv-main">
        <LvIconRail
          active={rail}
          onActivate={setRail}
          onOpenSettings={() => setSettingsOpen((v) => !v)}
          settingsOpen={settingsOpen}
        />
        {leftPanel}
        <LvViewer
          selectedFileIds={selectedIds}
          logsByFile={logsByFile}
          filesById={filesById}
          filters={filters}
          setFilters={(updater) => setFilters((prev) => updater(prev))}
          savedSearches={savedSearches}
          onSaveSearch={onSaveSearch}
          liveTail={liveTail}
          onToggleLiveTail={() => setLiveTail((v) => !v)}
          tabs={tabs}
          activeTabId={effectiveActiveTabId}
          onActivateTab={setActiveTabId}
          onCloseTab={(id) =>
            setClosedTabs((s) => {
              const n = new Set(s);
              n.add(id);
              return n;
            })
          }
          bookmarks={bookmarks}
          onBookmark={onBookmark}
          tweaks={tweaks}
          timelineOn={tweaks.timelineOn}
          onToggleTimeline={() => setTweak('timelineOn', !tweaks.timelineOn)}
          groupBy={groupBy}
          setGroupBy={setGroupBy}
          renderDetailEditor={renderDetailEditor}
        />
      </div>
      <LvStatusBar
        stats={{ files: stats.files, errors: stats.errors, warns: stats.warns }}
        liveTail={liveTail}
        theme={tweaks.theme}
      />

      {cmdOpen && <LvCommandPalette onClose={() => setCmdOpen(false)} onRun={runCommand} />}

      <LvSettingsPopover
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        tweaks={tweaks}
        setTweak={setTweak}
      />

      <LvShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      <LvTweaksPanel
        isOpen={tweaksPanelOpen}
        onClose={() => onCloseTweaks?.()}
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
