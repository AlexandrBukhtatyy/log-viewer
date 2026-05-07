import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GroupBucket } from '../../core/rpc/coordinator.contract.ts';
import {
  EMPTY_FILTER,
  type FieldFilter,
  type LogEntry,
  type LogFilter,
  type SourceId,
} from '../../core/types/index.ts';
import { entryFingerprint } from '../../core/util/fingerprint.ts';
import { getEntryFieldValue } from '../../core/filter/field-key.ts';
import { useExport } from '../../hooks/use-export.ts';
import { useFieldSchema } from '../../hooks/use-field-schema.ts';
import { useGroupCounts } from '../../hooks/use-group-counts.ts';
import { useHistogram } from '../../hooks/use-histogram.ts';
import { useLogFilter } from '../../hooks/use-log-filter.ts';
import { useLogWindow } from '../../hooks/use-log-window.ts';
import { useSourceController } from '../../hooks/use-source-controller.ts';
import { useSourceStatus } from '../../hooks/use-source-status.ts';
import { useDirectoryTrees } from '../../hooks/use-directory-trees.ts';
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

const HISTOGRAM_BUCKETS = 80;
const GROUP_LIMIT = 200;

/**
 * Map UI group-by token to the SQL field name used by `coordinator.getGroupCounts`.
 * `kind` is UI-only (file-meta classification) — returns null so the hook
 * stays inactive and LvViewer falls back to the entry stream.
 */
const lvGroupByToCoreField = (g: LvGroupBy | undefined): string | null => {
  if (!g) return null;
  switch (g) {
    case 'level':
      return 'level';
    case 'file':
      return 'source_id';
    case 'service':
    case 'trace_id':
    case 'req_id':
    case 'user_id':
      return g;
    case 'kind':
      return null;
  }
};
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
  // `selectedIds` may contain plain `SourceId` strings *and* compound ids
  // shaped as `<sourceId>::<relativePath>` (or `…::<path>/` for folders) when
  // the user picks individual files inside a directory tree (see
  // `useDirectoryTrees`). The `filter` useMemo below splits them apart.
  const [selectedIds, setSelectedIdsState] = useState<Set<string>>(() => new Set());
  const [activeTabId, setActiveTabId] = useState<string>('__all__');
  const [closedTabs, setClosedTabsState] = useState<Set<string>>(() => new Set());
  const [groupBy, setGroupBy] = useState<LvGroupBy[]>([]);
  const [liveTail, setLiveTail] = useState(false);

  const setSelectedIds = useCallback(
    (updater: (prev: Set<string>) => Set<string>) => {
      setSelectedIdsState((prev) => updater(prev));
    },
    [],
  );
  const setClosedTabs = useCallback(
    (updater: (prev: Set<string>) => Set<string>) => {
      setClosedTabsState((prev) => updater(prev));
    },
    [],
  );

  /**
   * Project the user's selection (a flat `Set<string>` that mixes plain
   * source-ids and compound `<sourceId>::<relPath>` ids) onto the core
   * filter shape. Compound ids contribute their relative path to
   * `filter.filePaths`; the source itself always lands in `filter.sources`.
   *
   * Folder-level compound ids (`…::sub/`) keep their trailing slash — those
   * become an `IN` predicate on `JSON_EXTRACT($.file_path)` and would never
   * match (file paths have no trailing slash). To select all files under a
   * folder the UI explodes the folder into its file ids upstream
   * (LvTreeNode toggle); this function only translates whatever is in
   * `selectedIds` to SQL inputs.
   */
  const splitSelection = useCallback(
    (
      ids: Iterable<string>,
      restrictToSource: string | null,
    ): { sources: SourceId[]; filePaths: string[] } => {
      const sourcesSet = new Set<string>();
      const paths: string[] = [];
      for (const id of ids) {
        const sep = id.indexOf('::');
        const sid = sep === -1 ? id : id.slice(0, sep);
        if (restrictToSource !== null && sid !== restrictToSource) continue;
        sourcesSet.add(sid);
        if (sep !== -1) {
          const path = id.slice(sep + 2);
          // Skip folder-level ids and the empty path; they're either UX
          // indicators ("everything under this folder") or root sentinels.
          if (path !== '' && !path.endsWith('/')) paths.push(path);
        }
      }
      return {
        sources: [...sourcesSet] as SourceId[],
        filePaths: paths,
      };
    },
    [],
  );

  // Effective filter — combine stored coreFilter with sources/filePaths
  // derived from selection. UI components read this; ViewStore receives this
  // via the sync effect below.
  const filter = useMemo<LogFilter>(() => {
    const restrict = activeTabId === '__all__' ? null : activeTabId;
    const { sources: sourcesArr, filePaths } = splitSelection(selectedIds, restrict);
    return {
      ...coreFilter,
      sources: sourcesArr.length === 0 ? null : sourcesArr,
      filePaths: filePaths.length === 0 ? null : filePaths,
    };
  }, [coreFilter, selectedIds, activeTabId, splitSelection]);

  const setFilter = useCallback(
    (next: (prev: LogFilter) => LogFilter) => {
      setCoreFilter((prev) => {
        const restrict = activeTabId === '__all__' ? null : activeTabId;
        const { sources: sourcesArr, filePaths } = splitSelection(
          selectedIds,
          restrict,
        );
        const effectivePrev: LogFilter = {
          ...prev,
          sources: sourcesArr.length === 0 ? null : sourcesArr,
          filePaths: filePaths.length === 0 ? null : filePaths,
        };
        const computed = next(effectivePrev);
        // Strip sources/filePaths — they're derived from selection.
        return { ...computed, sources: null, filePaths: null };
      });
    },
    [activeTabId, selectedIds, splitSelection],
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

  // Field schema discovery (ADR-0017) — drives the column picker /
  // group-by picker / filter-on-field popovers.
  const { descriptors: fieldDescriptors } = useFieldSchema();
  const onColumnsChange = useCallback(
    (next: ReadonlyArray<{ key: string; label?: string; widthPx: number }>) => {
      tweaks.setTweak('columns', next);
    },
    [tweaks],
  );
  const sourceRecordsById = useMemo(() => {
    const m = new Map<SourceId, (typeof sources)[number]>();
    for (const r of sources) m.set(r.source.id, r);
    return m;
  }, [sources]);
  const cellValueOf = useCallback(
    (entry: LogEntry, key: string) =>
      getEntryFieldValue(entry, key, sourceRecordsById.get(entry.sourceId) ?? null),
    [sourceRecordsById],
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

  const exportHook = useExport();
  const onExport = useCallback(
    (format: 'jsonl' | 'csv') => {
      void exportHook.exportFiltered(format);
    },
    [exportHook],
  );

  // Catalog + filesById from live SourceRecord[].
  const { trees: directoryTrees } = useDirectoryTrees(sources);
  const catalog = useMemo(
    () => buildCatalogTree(sources, directoryTrees),
    [sources, directoryTrees],
  );
  const filesById = useMemo(() => filesByIdFromSources(sources), [sources]);
  // Snapshot of currently-ingested source display names — feeds the
  // "Add source" modal's name-uniqueness validator.
  const existingSourceNames = useMemo(
    () => new Set(sources.map((r) => r.source.name)),
    [sources],
  );

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

  // Resolve LogEntry for each bookmarked fingerprint from the cached window.
  // Bookmarks store stable `<sourceId>:<fnv1a(raw)>` keys (see entryFingerprint),
  // so they survive a re-ingest where entry.id (UUID) is regenerated.
  const bookmarkEntries = useMemo<Record<string, LogEntry>>(() => {
    const out: Record<string, LogEntry> = {};
    for (let i = 0; i < filteredCount; i++) {
      const e = getRow(i);
      if (!e) continue;
      const key = entryFingerprint(e);
      if (bookmarksHook.ids.has(key as never)) out[key] = e;
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

  // Server-aggregated group buckets when the user picked a group-by axis.
  const groupField = lvGroupByToCoreField(groupBy[0]);
  const { buckets: groupBuckets } = useGroupCounts(groupField, GROUP_LIMIT);

  // Server-aggregated histogram — only when the timeline is on, otherwise we
  // keep the worker idle.
  const { data: histogramData } = useHistogram(
    tweaks.timelineOn ? HISTOGRAM_BUCKETS : 0,
  );

  // Drill into a group: append a fieldFilter for the bucket value and clear
  // group-by so the entry stream comes back. `null` value (missing field) is
  // mapped to an "exists" semantics by skipping the drill.
  const onGroupDrillDown = useCallback(
    (bucket: GroupBucket, field: string) => {
      if (bucket.value === null) {
        setGroupBy([]);
        return;
      }
      const ff: FieldFilter = { key: field, op: '=', value: bucket.value };
      setFilter((f) => ({ ...f, fieldFilters: [...(f.fieldFilters ?? []), ff] }));
      setGroupBy([]);
    },
    [setFilter],
  );

  // Level counts for the filter bar — derived from histogram (sum across
  // buckets gives total filtered counts per level).
  const levelCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const b of histogramData.buckets) {
      for (const [lvl, n] of Object.entries(b.levelCounts)) {
        out[lvl] = (out[lvl] ?? 0) + n;
      }
    }
    return out;
  }, [histogramData]);

  const stats = useMemo(() => {
    let ingestingSources = 0;
    let ingestingEntries = 0;
    for (const r of sources) {
      if (
        r.status.kind === 'loading' ||
        r.status.kind === 'indexing' ||
        r.status.kind === 'streaming'
      ) {
        ingestingSources++;
        if (r.status.kind === 'indexing' || r.status.kind === 'streaming') {
          ingestingEntries += r.status.entriesIndexed;
        }
      }
    }
    return {
      files: selectedIds.size,
      errors: (levelCounts.error ?? 0) + (levelCounts.fatal ?? 0),
      warns: levelCounts.warn ?? 0,
      ingestingSources,
      ingestingEntries,
    };
  }, [selectedIds, levelCounts, sources]);

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

  // Submit handler for the LvAddSourceModal — currently only fires for the
  // local-folder kind. Folder picker is owned by the modal; this just does
  // the RPC.
  const onSubmitAddSource = useCallback(
    async (data: {
      handle: FileSystemDirectoryHandle;
      name: string;
      watch: boolean;
      glob: string | null;
    }) => {
      try {
        await sourceCtrl.addDirectory({
          handle: data.handle,
          name: data.name,
          watch: data.watch,
          glob: data.glob ?? undefined,
        });
      } catch (e) {
        console.warn('addDirectory failed', e);
      }
    },
    [sourceCtrl],
  );

  const onAddRoot = useCallback(
    async (kind: LvSourceKind) => {
      try {
        switch (kind) {
          case 'local-static':
          case 'local-live':
            // Handled by LvAddSourceModal → onSubmitAddSource. LvApp won't
            // forward these kinds here, but we keep the no-op for safety.
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

  const onGrantPermission = useCallback(
    (id: string) => {
      void sourceCtrl.grantPermission(id as SourceId).catch((err: unknown) => {
        console.warn('grantPermission failed', err);
      });
    },
    [sourceCtrl],
  );

  const onCancelSource = useCallback(
    (id: string) => {
      void sourceCtrl.cancelSource(id as SourceId).catch((err: unknown) => {
        console.warn('cancelSource failed', err);
      });
    },
    [sourceCtrl],
  );

  const onRemoveRoot = useCallback(
    (rootId: string) => {
      // Each catalog root is a single ingested source — rootId === source.id.
      // Drop the source plus any selection entries that referenced it
      // (plain source-id and compound `<sourceId>::<path>` ids).
      const sid = rootId as SourceId;
      void sourceCtrl.removeSource(sid);
      setSelectedIds((s) => {
        const n = new Set<string>();
        const prefix = `${rootId}::`;
        for (const id of s) {
          if (id === rootId) continue;
          if (id.startsWith(prefix)) continue;
          n.add(id);
        }
        return n;
      });
    },
    [sourceCtrl, setSelectedIds],
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
      onSubmitAddSource={onSubmitAddSource}
      existingSourceNames={existingSourceNames}
      onGrantPermission={onGrantPermission}
      onCancelSource={onCancelSource}
      tweaks={{
        theme: tweaks.theme,
        density: tweaks.density,
        wrap: tweaks.wrap,
        showDate: tweaks.showDate,
        accent: tweaks.accent,
        timelineOn: tweaks.timelineOn,
        sidebarWidth: tweaks.sidebarWidth,
        sidebarCollapsed: tweaks.sidebarCollapsed,
        columns: tweaks.columns,
      }}
      setTweak={setTweak}
      bookmarks={bookmarksHook.ids as ReadonlySet<string>}
      toggleBookmark={toggleBookmark}
      bookmarkKeyOf={entryFingerprint}
      bookmarkEntries={bookmarkEntries}
      savedSearches={savedSearches}
      onSaveSearch={onSaveSearch}
      recentFiles={recentFiles}
      liveTail={liveTail}
      onToggleLiveTail={() => setLiveTail((v) => !v)}
      groupBy={groupBy}
      setGroupBy={setGroupBy}
      groupBuckets={groupField !== null ? groupBuckets : null}
      groupField={groupField}
      onGroupDrillDown={onGroupDrillDown}
      fieldDescriptors={fieldDescriptors}
      columns={tweaks.columns}
      onColumnsChange={onColumnsChange}
      cellValueOf={cellValueOf}
      onExport={onExport}
      histogramData={histogramData}
      stats={stats}
    />
  );
};
