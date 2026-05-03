import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  EMPTY_FILTER,
  type LogEntry,
  type LogFilter,
  type SourceId,
} from '../../core/types/index.ts';
import { useLogFilter } from '../../hooks/use-log-filter.ts';
import { useLogWindow } from '../../hooks/use-log-window.ts';
import { useSourceController } from '../../hooks/use-source-controller.ts';
import { useSourceStatus } from '../../hooks/use-source-status.ts';
import { useUiPrefs } from '../../hooks/use-ui-prefs.ts';
import { useBookmarks } from '../../hooks/use-bookmarks.ts';
import { useRecentFiles } from '../../hooks/use-recent-files.ts';
import { useSavedSearches } from '../../hooks/use-saved-searches.ts';
import { LvApp } from '../../ui/components/layout/LvApp.tsx';
import type {
  LvGroupBy,
  LvSavedSearch,
  LvSourceKind,
  LvTab,
  LvTweaks,
} from '../../ui/contracts/lv-types.ts';
import {
  buildCatalogTree,
  filesByIdFromSources,
} from '../../ui/utils/build-catalog.ts';

const promptOrEmpty = (msg: string, def = ''): string =>
  (typeof window !== 'undefined' && window.prompt(msg, def)) || '';

const pickFile = async (accept: string): Promise<File | null> =>
  new Promise<File | null>((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.onchange = () => resolve(inp.files?.[0] ?? null);
    inp.oncancel = () => resolve(null);
    inp.click();
  });

export const LvAppContainer = () => {
  // Filter — single source of truth for UI controls. `sources` is derived from
  // selection (see below), so we strip it from the locally-stored core filter
  // and re-attach when computing the effective filter.
  const [coreFilter, setCoreFilter] = useState<LogFilter>(EMPTY_FILTER);
  const { setFilter: pushFilter } = useLogFilter();

  // Source state.
  const sources = useSourceStatus().sources;
  const sourceCtrl = useSourceController();

  // Windowed entry stream.
  const { totalCount, filteredCount, getRow, setVisibleRange } = useLogWindow();

  // UI state — selection, tabs, group-by, live tail.
  const [selectedIds, setSelectedIdsState] = useState<Set<SourceId>>(() => new Set());
  const [activeTabId, setActiveTabId] = useState<string>('__all__');
  const [closedTabs, setClosedTabsState] = useState<Set<string>>(() => new Set());
  const [groupBy, setGroupBy] = useState<LvGroupBy[]>([]);
  const [liveTail, setLiveTail] = useState(false);

  const setSelectedIds = useCallback(
    (updater: (prev: Set<string>) => Set<string>) => {
      setSelectedIdsState(
        (prev) => updater(prev as Set<string>) as Set<SourceId>,
      );
    },
    [],
  );
  const setClosedTabs = useCallback(
    (updater: (prev: Set<string>) => Set<string>) => {
      setClosedTabsState((prev) => updater(prev));
    },
    [],
  );

  // Effective filter — combine stored coreFilter with sources derived from
  // selection. UI components read this; ViewStore receives this via the sync
  // effect below.
  const filter = useMemo<LogFilter>(() => {
    const sourcesArr =
      activeTabId === '__all__'
        ? (Array.from(selectedIds) as SourceId[])
        : ([activeTabId as SourceId]);
    return {
      ...coreFilter,
      sources: sourcesArr.length === 0 ? null : sourcesArr,
    };
  }, [coreFilter, selectedIds, activeTabId]);

  const setFilter = useCallback(
    (next: (prev: LogFilter) => LogFilter) => {
      setCoreFilter((prev) => {
        const sourcesArr =
          activeTabId === '__all__'
            ? (Array.from(selectedIds) as SourceId[])
            : ([activeTabId as SourceId]);
        const effectivePrev: LogFilter = {
          ...prev,
          sources: sourcesArr.length === 0 ? null : sourcesArr,
        };
        const computed = next(effectivePrev);
        // Strip sources — they're derived from selection, not stored.
        return { ...computed, sources: null };
      });
    },
    [activeTabId, selectedIds],
  );

  // Push effective filter to ViewStore (writes a Zustand store outside React's
  // render cycle — not a React setState; layered as external-system sync).
  useEffect(() => {
    pushFilter(filter);
  }, [filter, pushFilter]);

  // UI persistence hooks.
  const tweaks = useUiPrefs();
  const setTweak = useCallback(
    <K extends keyof LvTweaks>(key: K, value: LvTweaks[K]) => {
      tweaks.setTweak(key, value);
    },
    [tweaks],
  );

  const bookmarksHook = useBookmarks();
  const toggleBookmark = useCallback(
    (id: string) => bookmarksHook.toggle(id as never),
    [bookmarksHook],
  );

  const recentFilesStore = useRecentFiles();
  const recentFiles = recentFilesStore.list;

  const savedSearchesStore = useSavedSearches();
  const savedSearches = savedSearchesStore.list;

  // Catalog + filesById from live SourceRecord[].
  const catalog = useMemo(() => buildCatalogTree(sources), [sources]);
  const filesById = useMemo(() => filesByIdFromSources(sources), [sources]);

  // Tabs: __all__ + one tab per selected (non-closed) source.
  const tabs = useMemo<LvTab[]>(() => {
    const t: LvTab[] = [
      { id: '__all__', name: `All selected (${selectedIds.size})`, kind: 'app' },
    ];
    for (const id of selectedIds) {
      const file = filesById[id];
      if (!file || closedTabs.has(id)) continue;
      t.push({ id, name: file.name, path: file.path, kind: file.kind });
    }
    return t;
  }, [selectedIds, closedTabs, filesById]);

  // Drop activeTabId back to __all__ if its source was deselected/closed —
  // derived-state pattern (set during render, gated by signature comparison)
  // avoids the cascading-render lint on a setState-in-effect.
  const [prevTabSig, setPrevTabSig] = useState('');
  const tabSig = `${activeTabId}|${[...selectedIds].sort().join(',')}|${[...closedTabs].sort().join(',')}`;
  if (tabSig !== prevTabSig) {
    setPrevTabSig(tabSig);
    if (
      activeTabId !== '__all__' &&
      (!selectedIds.has(activeTabId as SourceId) || closedTabs.has(activeTabId))
    ) {
      setActiveTabId('__all__');
    }
  }

  // Touch recent-files when selection grows.
  useEffect(() => {
    for (const id of selectedIds) {
      const f = filesById[id];
      if (f) recentFilesStore.touch({ id, name: f.name, path: f.path });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: only on selection diff
  }, [selectedIds]);

  // Resolve LogEntry for each bookmarked id from the cached window.
  const bookmarkEntries = useMemo<Record<string, LogEntry>>(() => {
    const out: Record<string, LogEntry> = {};
    for (let i = 0; i < filteredCount; i++) {
      const e = getRow(i);
      if (e && bookmarksHook.ids.has(e.id)) out[e.id] = e;
    }
    return out;
  }, [filteredCount, getRow, bookmarksHook.ids]);

  // Saved-search add: capture current filter.
  const onSaveSearch = useCallback(() => {
    const name = promptOrEmpty('Save current filter as preset:');
    if (!name) return;
    const search: LvSavedSearch = {
      id: `custom-${Date.now()}`,
      name,
      query: filter.query,
      levels: filter.levels ? [...filter.levels] : [],
    };
    savedSearchesStore.add(search);
  }, [filter, savedSearchesStore]);

  // Status-bar stats — Phase 1 placeholder (level breakdown lands with
  // server-side aggregates in Phase 2).
  const stats = useMemo(
    () => ({ files: selectedIds.size, errors: 0, warns: 0 }),
    [selectedIds],
  );
  const levelCounts = useMemo(() => ({}), []);

  // File-pickers / per-kind add-source dispatch.
  const onOpenLocalFile = useCallback(async () => {
    const file = await pickFile('.log,.txt,.json,.jsonl,.ndjson,.out,.err');
    if (!file) return;
    try {
      await sourceCtrl.addFile(file);
    } catch (e) {
      console.warn('addFile failed', e);
    }
  }, [sourceCtrl]);

  const onAddRoot = useCallback(
    async (kind: LvSourceKind) => {
      try {
        switch (kind) {
          case 'local-static':
          case 'local-live':
            await sourceCtrl.addDirectory();
            break;
          case 'stream': {
            const url = promptOrEmpty('WebSocket / SSE URL:', 'wss://example/');
            if (!url) return;
            await sourceCtrl.addStream(url);
            break;
          }
          case 'remote-ssh': {
            const host = promptOrEmpty('SSH host (e.g. user@10.4.7.21):');
            if (!host) return;
            await sourceCtrl.addRemoteSsh({ host });
            break;
          }
          case 'cloud': {
            const query = promptOrEmpty('Cloud query (Datadog stub):');
            await sourceCtrl.addCloud({ provider: 'datadog', query });
            break;
          }
          case 'k8s': {
            const cluster = promptOrEmpty('k8s cluster:', 'prod-eu');
            if (!cluster) return;
            await sourceCtrl.addK8s({ cluster });
            break;
          }
          case 'bus': {
            const broker = promptOrEmpty('Broker URL:', 'kafka://broker-1:9092');
            const topic = promptOrEmpty('Topic:', 'events');
            if (!broker || !topic) return;
            await sourceCtrl.addBus({ broker, topic });
            break;
          }
          case 'db': {
            const url = promptOrEmpty('DB URL:', 'clickhouse://logs.events');
            const q = promptOrEmpty('Query:', 'SELECT * FROM logs LIMIT 100');
            if (!url || !q) return;
            await sourceCtrl.addDb({ dialect: 'clickhouse', url, query: q });
            break;
          }
          case 'snapshot': {
            const file = await pickFile('.zip,.tar,.tar.gz,.tgz');
            if (!file) return;
            await sourceCtrl.addSnapshot(file);
            break;
          }
          case 'bookmark':
            // 'bookmark' is a saved view, not an ingestion source — handled
            // via the bookmarks panel instead.
            break;
        }
      } catch (e) {
        console.warn(`addSource(${kind}) failed`, e);
      }
    },
    [sourceCtrl],
  );

  const onRemoveRoot = useCallback(
    (rootId: string) => {
      // Catalog roots have id `lv-root-<lvKind>` — remove every contained file.
      // For now: remove every selected source whose lvKind matches that root.
      const lvKind = rootId.replace(/^lv-root-/, '');
      const toRemove: SourceId[] = [];
      for (const rec of sources) {
        const recLvKind = rec.source.kind === 'directory' || rec.source.kind === 'file' || rec.source.kind === 'text' ? 'local-static' : rec.source.kind === 'url' ? 'cloud' : rec.source.kind;
        if (recLvKind === lvKind) toRemove.push(rec.source.id);
      }
      for (const id of toRemove) {
        void sourceCtrl.removeSource(id);
      }
      setSelectedIds((s) => {
        const n = new Set(s);
        for (const id of toRemove) n.delete(id);
        return n;
      });
    },
    [sources, sourceCtrl, setSelectedIds],
  );

  return (
    <LvApp
      catalog={catalog}
      filesById={filesById}
      rowCount={filteredCount}
      totalCount={totalCount}
      getRow={getRow}
      onVisibleRangeChange={setVisibleRange}
      levelCounts={levelCounts}
      filter={filter}
      setFilter={setFilter}
      selectedIds={selectedIds}
      setSelectedIds={setSelectedIds}
      activeTabId={activeTabId}
      setActiveTabId={setActiveTabId}
      tabs={tabs}
      setClosedTabs={setClosedTabs}
      onAddRoot={onAddRoot}
      onRemoveRoot={onRemoveRoot}
      onOpenLocalFile={onOpenLocalFile}
      tweaks={{
        theme: tweaks.theme,
        density: tweaks.density,
        wrap: tweaks.wrap,
        showDate: tweaks.showDate,
        accent: tweaks.accent,
        timelineOn: tweaks.timelineOn,
      }}
      setTweak={setTweak}
      bookmarks={bookmarksHook.ids as ReadonlySet<string>}
      toggleBookmark={toggleBookmark}
      bookmarkEntries={bookmarkEntries}
      savedSearches={savedSearches}
      onSaveSearch={onSaveSearch}
      recentFiles={recentFiles}
      liveTail={liveTail}
      onToggleLiveTail={() => setLiveTail((v) => !v)}
      groupBy={groupBy}
      setGroupBy={setGroupBy}
      stats={stats}
    />
  );
};
