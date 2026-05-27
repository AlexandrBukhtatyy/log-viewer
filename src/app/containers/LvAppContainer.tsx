import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GroupBucket } from '../../core/rpc/coordinator.contract.ts';
import {
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
import { useViewStore } from '../providers/view-store-context.ts';
import { useSourceController } from '../../hooks/use-source-controller.ts';
import { useSourceStatus } from '../../hooks/use-source-status.ts';
import { useDirectoryTrees } from '../../hooks/use-directory-trees.ts';
import { useUiPrefs } from '../../hooks/use-ui-prefs.ts';
import { useBookmarks } from '../../hooks/use-bookmarks.ts';
import { useRecentFiles } from '../../hooks/use-recent-files.ts';
import { useSavedSearches } from '../../hooks/use-saved-searches.ts';
import { useWorkspace, useWorkspaceStore } from '../../hooks/use-workspace.ts';
import { clearPwaCache, clearUiState } from '../clear-app-data.ts';
import { LvApp } from '../../ui/components/layout/LvApp.tsx';
import { resolveActiveColumns } from '../../ui/utils/active-columns.ts';
import {
  compileVirtualFields,
  isVirtualFieldKey,
  resolveVirtualField,
} from '../../ui/utils/virtual-fields.ts';
import type {
  LvGroupBy,
  LvLogKind,
  LvNode,
  LvSavedSearch,
  LvSourceKind,
  LvTab,
  LvTweaks,
} from '../../ui/contracts/lv-types.ts';
import type { CustomParserDef as LvCustomParserDef } from '../../core/parsers/custom-parser-def.ts';

const HISTOGRAM_BUCKETS = 80;
const GROUP_LIMIT = 200;

/**
 * Pick the active group field for `coordinator.getGroupCounts`.
 *
 * After ADR-0017 Phase 6, `LvGroupBy` is a free-form `FieldKey`,
 * so the value flows straight through — `groupFieldExpr` decides
 * whether `level` becomes `entry.level` or `JSON_EXTRACT(...)`.
 * The legacy `'kind'` token (UI-only, never had a SQL mapping) is
 * still recognised and disables the hook.
 */
const lvGroupByToCoreField = (g: LvGroupBy | undefined): string | null => {
  if (!g) return null;
  if (g === 'kind') return null;
  return g;
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
  const { setFilter: pushFilter } = useLogFilter();

  // Source state.
  const { sources, hydrated: sourcesHydrated } = useSourceStatus();
  const sourceCtrl = useSourceController();

  // Windowed entry stream.
  const { totalCount, filteredCount, getRow, setVisibleRange, isLoading, hasLoadedEntries } = useLogWindow();

  // Workspace — tabs, selection, filter, group-by, live-tail (ADR-NNNN).
  // Persisted to `localStorage['lv:workspace']` so the user's working
  // session survives reload. Setters are stable refs from the store;
  // `selectedIds` is a `Set` rebuilt on each mutation. Compound ids
  // (`<sourceId>::<relativePath>`) live in the same `selectedIds` Set
  // as plain source ids — the filter useMemo below splits them apart.
  const {
    coreFilter,
    openTabs,
    activeTabId,
    selectedIds,
    groupBy,
    liveTail,
    hydrated: workspaceHydrated,
    setOpenTabs,
    setActiveTabId,
    setSelectedIds,
    setCoreFilter,
    setGroupBy,
    setLiveTail,
    removeSource: workspaceRemoveSource,
    pruneMissingSources,
  } = useWorkspace();

  /**
   * Project the user's selection (a flat `Set<string>` that mixes plain
   * source-ids and compound `<sourceId>::<relPath>` ids) onto the core
   * filter shape. Compound ids contribute their relative path to
   * `filter.filePaths`; the source itself always lands in `filter.sources`.
   *
   * Folder-level compound ids (`…::sub/`) keep their trailing slash — those
   * become an `IN` predicate on `entry.file_path` (via the `@file`
   * field-key) and would never match (file paths have no trailing
   * slash). To select all files under a folder the UI explodes the
   * folder into its file ids upstream (LvTreeNode toggle); this
   * function only translates whatever is in `selectedIds` to SQL
   * inputs.
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
  // Resolves the source/filePath inputs that go into the effective
  // filter, based on the current `activeTabId`:
  //   - `'__all__'` → all sidebar-checked items (multi-select view).
  //   - plain SourceId → only that source (single-file view).
  //   - compound `<sourceId>::<relPath>` (nested file inside a walked
  //     directory) → that source restricted to the one file path.
  const tabSelection = useCallback((): { sourcesArr: SourceId[]; filePaths: string[] } => {
    if (activeTabId === '__all__') {
      const { sources: s, filePaths } = splitSelection(selectedIds, null);
      return { sourcesArr: s, filePaths };
    }
    const sep = activeTabId.indexOf('::');
    if (sep === -1) {
      return { sourcesArr: [activeTabId as SourceId], filePaths: [] };
    }
    const baseSrc = activeTabId.slice(0, sep) as SourceId;
    const relPath = activeTabId.slice(sep + 2);
    return {
      sourcesArr: [baseSrc],
      filePaths: relPath && !relPath.endsWith('/') ? [relPath] : [],
    };
  }, [activeTabId, selectedIds, splitSelection]);

  const filter = useMemo<LogFilter>(() => {
    const { sourcesArr, filePaths } = tabSelection();
    return {
      ...coreFilter,
      sources: sourcesArr.length === 0 ? null : sourcesArr,
      filePaths: filePaths.length === 0 ? null : filePaths,
    };
  }, [coreFilter, tabSelection]);

  const setFilter = useCallback(
    (next: (prev: LogFilter) => LogFilter) => {
      setCoreFilter((prev) => {
        const { sourcesArr, filePaths } = tabSelection();
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
    [tabSelection, setCoreFilter],
  );

  // Push effective filter to ViewStore (writes a Zustand store outside React's
  // render cycle — not a React setState; layered as external-system sync).
  useEffect(() => {
    pushFilter(filter);
  }, [filter, pushFilter]);

  // Push focus (sources/files the user is staring at) to the coordinator so
  // it can prioritise parser-pool batches and reorder directory adapters'
  // read plans. Union of "active tab's source(s)/file" and everything in the
  // sidebar's multi-select Set, so the all-tab view treats every checked
  // file as hot.
  useEffect(() => {
    const fromTab = tabSelection();
    const fromSelection = splitSelection(selectedIds, null);
    const sources = Array.from(
      new Set<SourceId>([...fromTab.sourcesArr, ...fromSelection.sources]),
    );
    const filePaths = Array.from(
      new Set<string>([...fromTab.filePaths, ...fromSelection.filePaths]),
    );
    void sourceCtrl.setFocus({ sources, filePaths }).catch((err: unknown) => {
      console.warn('[LvAppContainer] setFocus failed', err);
    });
  }, [activeTabId, selectedIds, tabSelection, splitSelection, sourceCtrl]);

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
  // Per-tab column profile (Phase 1, A+D in
  // docs/plans/columns-multi-format-impl.md):
  //  - `'__all__'` aggregate tab → reads/writes the global
  //    `tweaks.columns` (legacy behavior).
  //  - Per-file tab → reads from `tab.columns ?? tweaks.columns`,
  //    writes to `tab.columns` so each file tab keeps its own
  //    format-specific column set.
  // `useWorkspaceStore.getState()` reads the live id so the callback
  // doesn't re-create on every tab switch.
  const onColumnsChange = useCallback(
    (next: ReadonlyArray<{ key: string; label?: string; widthPx: number }>) => {
      const id = useWorkspaceStore.getState().activeTabId;
      if (id === '__all__') {
        tweaks.setTweak('columns', next);
        return;
      }
      setOpenTabs((prev) =>
        prev.map((t) => (t.id === id ? { ...t, columns: next } : t)),
      );
    },
    [tweaks, setOpenTabs],
  );
  const activeColumns = useMemo(
    () => resolveActiveColumns(activeTabId, openTabs, tweaks.columns),
    [activeTabId, openTabs, tweaks.columns],
  );
  // Per-tab virtual fields (Phase 2 of
  // docs/plans/columns-multi-format-impl.md). Only meaningful for
  // file tabs — the `__all__` aggregate tab has no parser context and
  // the column builder is hidden there. Writes go into the active
  // tab's `virtualFields`, never into the global `tweaks`.
  const onVirtualFieldsChange = useCallback(
    (
      next: ReadonlyArray<{
        key: string;
        label?: string;
        pattern: string;
        group: string;
        target?: 'raw' | 'message';
      }>,
    ) => {
      const id = useWorkspaceStore.getState().activeTabId;
      if (id === '__all__') return;
      setOpenTabs((prev) =>
        prev.map((t) =>
          t.id === id
            ? { ...t, virtualFields: next.length > 0 ? next : undefined }
            : t,
        ),
      );
    },
    [setOpenTabs],
  );

  // Phase 2.E: auto-apply parser's `defaultColumns` the first time a
  // source reports them, *and only if* the user hasn't picked any
  // columns yet. Tracked via a render-time signature so the new
  // `react-hooks/set-state-in-effect` rule doesn't trip; the actual
  // `tweaks.setTweak` is deferred to a microtask because it writes
  // to an external store (Zustand), and React 19 warns when that
  // happens during another component's render.
  const [parserHintSig, setParserHintSig] = useState('');
  const liveParserHintSig = sources
    .filter((r) => r.parserId && (r.parserDefaultColumns?.length ?? 0) > 0)
    .map((r) => r.source.id)
    .sort()
    .join(',');
  if (liveParserHintSig !== parserHintSig) {
    setParserHintSig(liveParserHintSig);
    if (tweaks.columns.length === 0) {
      const candidate = sources.find(
        (r) => r.parserId && (r.parserDefaultColumns?.length ?? 0) > 0,
      );
      const cols = candidate?.parserDefaultColumns ?? [];
      if (cols.length > 0) {
        const next = cols.map((k) => ({ key: k, widthPx: 140 }));
        queueMicrotask(() => tweaks.setTweak('columns', next));
      }
    }
  }
  const sourceRecordsById = useMemo(() => {
    const m = new Map<SourceId, (typeof sources)[number]>();
    for (const r of sources) m.set(r.source.id, r);
    return m;
  }, [sources]);
  // Stable read of the latest `sourceRecordsById` for callbacks (like
  // `openFileTab`) that shouldn't recreate on every source update.
  // The ref is synced in an effect — assigning during render violates
  // the `react-hooks/refs` rule on React 19.
  const sourceRecordsByIdRef = useRef(sourceRecordsById);
  useEffect(() => {
    sourceRecordsByIdRef.current = sourceRecordsById;
  }, [sourceRecordsById]);
  // Active tab's virtual fields, compiled once per tab change. Used by
  // the cell resolver below to evaluate `vf:` keys against entry.raw.
  const activeVirtualFields = useMemo(() => {
    if (activeTabId === '__all__') return [];
    const tab = openTabs.find((t) => t.id === activeTabId);
    return tab?.virtualFields ?? [];
  }, [activeTabId, openTabs]);
  const compiledVirtualFields = useMemo(
    () => compileVirtualFields(activeVirtualFields),
    [activeVirtualFields],
  );
  const cellValueOf = useCallback(
    (entry: LogEntry, key: string) => {
      if (isVirtualFieldKey(key)) {
        return resolveVirtualField(entry, key, compiledVirtualFields);
      }
      return getEntryFieldValue(entry, key, sourceRecordsById.get(entry.sourceId) ?? null);
    },
    [sourceRecordsById, compiledVirtualFields],
  );
  const parserIdOf = useCallback(
    (entry: LogEntry): string | undefined =>
      sourceRecordsById.get(entry.sourceId)?.parserId,
    [sourceRecordsById],
  );

  // Inline group-expand callbacks: bypass the active-filter/refresh
  // pipeline by going straight to the worker with an explicit filter.
  const viewStore = useViewStore();
  const fetchGroupCounts = useCallback(
    (f: LogFilter, field: string, limit?: number) =>
      viewStore.getState().getGroupCounts(f, field, limit),
    [viewStore],
  );
  const fetchEntries = useCallback(
    (f: LogFilter, from: number, to: number) =>
      viewStore.getState().getEntriesScoped(f, from, to),
    [viewStore],
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

  // File menu → Clear Application Data… — three independent scopes.
  // Worker-side data goes through the existing `clearAll` action (which
  // also handles ingest-abort + spool wipe per ADR-0022). UI-state and
  // PWA-cache clears live in `clear-app-data.ts`. PWA scope reloads the
  // page so the SW unregister actually takes effect on the next nav.
  //
  // Performance: the three scopes hit independent storage backends, so
  // we kick them in parallel and only await the union via Promise.all.
  // The synchronous LocalStorage wipe fires first so even if the worker
  // round-trip is slow, prefs are already gone.
  const onClearAppData = useCallback(
    async (scope: {
      indexData: boolean;
      uiState: boolean;
      pwaCache: boolean;
    }): Promise<void> => {
      if (scope.uiState) clearUiState();
      const tasks: Promise<unknown>[] = [];
      if (scope.indexData) tasks.push(sourceCtrl.clearAll());
      if (scope.pwaCache) tasks.push(clearPwaCache());
      await Promise.all(tasks);
      // SW unregister and LocalStorage wipe only take effect on a fresh
      // navigation — reload last so the modal close + caller-side
      // notifications happen first.
      if (scope.pwaCache || scope.uiState) {
        location.reload();
      }
    },
    [sourceCtrl],
  );

  // Catalog + filesById from live SourceRecord[].
  const { trees: directoryTrees } = useDirectoryTrees(sources);
  const catalog = useMemo(
    () => buildCatalogTree(sources, directoryTrees),
    [sources, directoryTrees],
  );
  const filesById = useMemo(() => filesByIdFromSources(sources), [sources]);

  // VS Code-style preview/pinned tabs. A single-click on a sidebar file
  // opens (or replaces) one preview slot — at most one preview tab lives
  // alongside any pinned tabs. Double-click on the tab itself promotes
  // it to pinned; from there it behaves like any other tab.
  const openFileTab = useCallback(
    (rawId: string) => {
      // Resolve the node. For root-level file sources the click delivers
      // a plain SourceId and `filesById` is enough. For files *inside* a
      // walked directory the id is compound (`<sourceId>::<relPath>`); we
      // walk the catalog to find the actual node so the tab inherits the
      // nested file's own `name`/`path`/`kind`, not its parent source.
      type FileLike = { id: string; name: string; path?: string; kind: LvLogKind };
      let file: FileLike | null = filesById[rawId] ?? null;
      if (file === null) {
        const walk = (nodes: ReadonlyArray<LvNode>): FileLike | null => {
          for (const n of nodes) {
            if (n.type === 'file' && n.id === rawId) return n;
            if (n.type === 'folder') {
              const hit = walk(n.children);
              if (hit) return hit;
            }
          }
          return null;
        };
        file = walk(catalog);
      }
      if (file === null) return;
      const resolved = file;
      // Phase 1.5: seed `tab.columns` from the source's parser-default
      // columns when they're already known. For compound ids
      // (`<sourceId>::<relPath>`) the parser lives on the base source.
      // If the parser hasn't been resolved yet (drag-n-drop just
      // happened), the backfill effect below picks it up once the
      // source reports `parserDefaultColumns`.
      const sep = rawId.indexOf('::');
      const baseSrcId = sep === -1 ? rawId : rawId.slice(0, sep);
      const srcRec = sourceRecordsByIdRef.current.get(baseSrcId as SourceId);
      const parserCols = srcRec?.parserDefaultColumns ?? [];
      const initialColumns =
        parserCols.length > 0
          ? parserCols.map((k) => ({ key: k, widthPx: 140 }))
          : undefined;
      setOpenTabs((prev) => {
        if (prev.some((t) => t.id === rawId)) return prev;
        const newTab: LvTab = {
          id: rawId,
          name: resolved.name,
          path: resolved.path,
          kind: resolved.kind,
          isPinned: false,
          ...(initialColumns ? { columns: initialColumns } : {}),
        };
        // Preview: replace any existing preview slot, otherwise append.
        const previewIdx = prev.findIndex((t) => !t.isPinned);
        if (previewIdx === -1) return [...prev, newTab];
        const next = prev.slice();
        next[previewIdx] = newTab;
        return next;
      });
      setActiveTabId(rawId);
    },
    [filesById, catalog, setOpenTabs, setActiveTabId],
  );

  // Phase 1.5 backfill: tabs opened before their source's parser was
  // resolved (or restored from localStorage on reload) end up with
  // `columns === undefined`. Once `parserDefaultColumns` becomes
  // available, populate `tab.columns` once. Subsequent user edits
  // (`onColumnsChange`) override and aren't re-stamped because
  // `t.columns` is then defined.
  useEffect(() => {
    setOpenTabs((prev) => {
      let mutated = false;
      const next = prev.map((t) => {
        if (t.id === '__all__') return t;
        if (t.columns !== undefined) return t;
        const sep = t.id.indexOf('::');
        const baseSrcId = sep === -1 ? t.id : t.id.slice(0, sep);
        const srcRec = sourceRecordsById.get(baseSrcId as SourceId);
        const parserCols = srcRec?.parserDefaultColumns ?? [];
        if (parserCols.length === 0) return t;
        mutated = true;
        return {
          ...t,
          columns: parserCols.map((k) => ({ key: k, widthPx: 140 })),
        };
      });
      return mutated ? next : prev;
    });
  }, [sourceRecordsById, setOpenTabs]);

  const pinTab = useCallback(
    (tabId: string) => {
      setOpenTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === tabId);
        if (idx === -1 || prev[idx].isPinned) return prev;
        const next = prev.slice();
        next[idx] = { ...prev[idx], isPinned: true };
        return next;
      });
    },
    [setOpenTabs],
  );

  const closeTab = useCallback(
    (tabId: string) => {
      setOpenTabs((prev) => prev.filter((t) => t.id !== tabId));
      // Read activeTabId from the store directly so we don't capture a
      // stale render-time value — `setActiveTabId` is a value setter, not
      // an updater.
      if (useWorkspaceStore.getState().activeTabId === tabId) {
        setActiveTabId('__all__');
      }
    },
    [setOpenTabs, setActiveTabId],
  );

  // Snapshot of currently-ingested source display names — feeds the
  // "Add source" modal's name-uniqueness validator.
  const existingSourceNames = useMemo(
    () => new Set(sources.map((r) => r.source.name)),
    [sources],
  );

  // Parsers registered in the worker — populates the parser-override
  // dropdown in `LvAddSourceModal` (Phase 2.B). Loaded once after the
  // worker is up; the list is static for the lifetime of the page.
  const [availableParsers, setAvailableParsers] = useState<
    ReadonlyArray<{ readonly id: string }>
  >([]);
  // User-defined parser definitions (Phase 2.C). Editable from the
  // Parsers rail panel; the coordinator broadcasts changes to every
  // pool worker through `loadCustomParsers`. Re-fetched whenever the
  // panel saves so the same list drives both the rail panel and the
  // Add-Source dropdown.
  const [customParsers, setCustomParsers] = useState<
    ReadonlyArray<LvCustomParserDef>
  >([]);
  const [parsersLoaded, setParsersLoaded] = useState(false);
  const reloadAvailableParsers = useCallback(async () => {
    try {
      const [all, custom] = await Promise.all([
        viewStore.getState().listParsers(),
        viewStore.getState().listCustomParsers(),
      ]);
      setAvailableParsers(all);
      setCustomParsers(custom);
    } catch (err) {
      console.warn('[LvAppContainer] listParsers failed', err);
    }
  }, [viewStore]);
  if (!parsersLoaded) {
    setParsersLoaded(true);
    void reloadAvailableParsers();
  }
  const onUpsertCustomParser = useCallback(
    async (def: LvCustomParserDef) => {
      await viewStore.getState().upsertCustomParser(def);
      await reloadAvailableParsers();
    },
    [viewStore, reloadAvailableParsers],
  );
  const onRemoveCustomParser = useCallback(
    async (id: string) => {
      await viewStore.getState().removeCustomParser(id);
      await reloadAvailableParsers();
    },
    [viewStore, reloadAvailableParsers],
  );

  // Tabs render order:
  //   1. `__all__` aggregate tab — pinned, always present, always first.
  //      Reflects the sidebar checkboxes (multi-select); when nothing is
  //      ticked it shows the empty-state copy in LvViewer.
  //   2. Per-file tabs the user opened by clicking a filename.
  //
  // The two are deliberately decoupled: the checkbox column drives the
  // multi-source aggregate view; clicking a filename opens that source
  // in its own tab without touching `selectedIds`.
  // Cleanup of ghost tabs and activeTabId is gated by `canPrune`: source
  // hydration AND workspace hydration must have landed, AND we must have
  // at least one real source. The third condition matters because the
  // coordinator's first status emit sets `sourcesHydrated=true` with an
  // empty array (before `hydratePersisted` re-emits). Without the
  // `sources.length > 0` gate, the tab filter and reset effect would
  // wipe the just-rehydrated workspace in that brief window.
  //
  // The edge case (user genuinely has zero sources after an external
  // wipe + non-empty workspace) lingers in localStorage but doesn't
  // visually appear — the canPrune-gated tabs filter shows persisted
  // entries unfiltered, and the next user action re-saves cleaned
  // state.
  const canPrune = sourcesHydrated && workspaceHydrated && sources.length > 0;

  const tabs = useMemo<LvTab[]>(() => {
    const t: LvTab[] = [
      {
        id: '__all__',
        name:
          selectedIds.size > 0
            ? `All selected (${selectedIds.size})`
            : 'All selected',
        kind: 'app',
      },
    ];
    for (const tab of openTabs) {
      // Filter out tabs whose source vanished from the catalog. Tab ids
      // for nested files inside a walked directory are compound
      // (`<sourceId>::<relPath>`); split before the lookup so they
      // survive while their parent source is still around.
      if (!canPrune) {
        // Keep all persisted tabs verbatim until hydration completes.
        t.push(tab);
        continue;
      }
      const sep = tab.id.indexOf('::');
      const baseSrc = sep === -1 ? tab.id : tab.id.slice(0, sep);
      if (filesById[baseSrc]) t.push(tab);
    }
    return t;
  }, [selectedIds, openTabs, filesById, canPrune]);

  // Drop activeTabId back to a sensible default when its tab disappears.
  // `setActiveTabId` is an external-store mutation (zustand workspace) —
  // React 19 forbids those during render, so defer to an effect.
  useEffect(() => {
    if (!canPrune) return;
    if (!tabs.some((t) => t.id === activeTabId)) {
      setActiveTabId(tabs[0]?.id ?? '__all__');
    }
  }, [canPrune, tabs, activeTabId, setActiveTabId]);

  // One-shot prune of selectedIds / openTabs against the live source set.
  // `sourcesHydrated` flips on the coordinator's first status emit, which
  // is the *empty* snapshot before persistedRecords land. Pruning then
  // would wipe the just-rehydrated workspace, so gate on
  // `sources.length > 0` too — once we see at least one real source we
  // know hydratePersisted has completed and the snapshot is settled.
  // Down-side: if a user genuinely has zero sources after some external
  // wipe, stale ids stay in localStorage; harmless visually (the
  // canPrune-gated tabs useMemo filters ghost rows out) and self-heals
  // on the next user action.
  const prunedRef = useRef(false);
  useEffect(() => {
    if (prunedRef.current || !canPrune) return;
    prunedRef.current = true;
    pruneMissingSources(new Set(sources.map((r) => r.source.id)));
  }, [canPrune, sources, pruneMissingSources]);

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
    [setFilter, setGroupBy],
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
        r.status.kind === 'queued' ||
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
      parserId?: string;
    }) => {
      try {
        await sourceCtrl.addDirectory({
          handle: data.handle,
          name: data.name,
          watch: data.watch,
          glob: data.glob ?? undefined,
          parserId: data.parserId,
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
      // Workspace store handles all the bookkeeping: drops the source-id
      // (and any `<sourceId>::path` compound ids) from selection and open
      // tabs, and collapses activeTabId to `'__all__'` if it pointed at
      // the removed source.
      void sourceCtrl.removeSource(rootId as SourceId);
      workspaceRemoveSource(rootId);
    },
    [sourceCtrl, workspaceRemoveSource],
  );

  return (
    <LvApp
      catalog={catalog}
      filesById={filesById}
      sourcesHydrated={sourcesHydrated}
      rowCount={filteredCount}
      totalCount={totalCount}
      getRow={getRow}
      onVisibleRangeChange={setVisibleRange}
      isLoading={isLoading}
      hasLoadedEntries={hasLoadedEntries}
      levelCounts={levelCounts}
      filter={filter}
      setFilter={setFilter}
      selectedIds={selectedIds}
      setSelectedIds={setSelectedIds}
      activeTabId={activeTabId}
      setActiveTabId={setActiveTabId}
      tabs={tabs}
      onOpenFile={openFileTab}
      onCloseTab={closeTab}
      onPinTab={pinTab}
      onAddRoot={onAddRoot}
      onRemoveRoot={onRemoveRoot}
      onOpenLocalFile={onOpenLocalFile}
      onSubmitAddSource={onSubmitAddSource}
      existingSourceNames={existingSourceNames}
      availableParsers={availableParsers}
      customParsers={customParsers}
      onUpsertCustomParser={onUpsertCustomParser}
      onRemoveCustomParser={onRemoveCustomParser}
      onGrantPermission={onGrantPermission}
      onCancelSource={onCancelSource}
      tweaks={{
        theme: tweaks.theme,
        density: tweaks.density,
        showDate: tweaks.showDate,
        accent: tweaks.accent,
        timelineOn: tweaks.timelineOn,
        sidebarWidth: tweaks.sidebarWidth,
        sidebarCollapsed: tweaks.sidebarCollapsed,
        columns: tweaks.columns,
        gutterMode: tweaks.gutterMode,
        presets: tweaks.presets,
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
      onToggleLiveTail={() => setLiveTail(!liveTail)}
      groupBy={groupBy}
      setGroupBy={setGroupBy}
      groupBuckets={groupField !== null ? groupBuckets : null}
      groupRootFilter={filter}
      fetchGroupCounts={fetchGroupCounts}
      fetchEntries={fetchEntries}
      groupField={groupField}
      onGroupDrillDown={onGroupDrillDown}
      fieldDescriptors={fieldDescriptors}
      columns={activeColumns}
      onColumnsChange={onColumnsChange}
      virtualFields={activeVirtualFields}
      onVirtualFieldsChange={onVirtualFieldsChange}
      cellValueOf={cellValueOf}
      parserIdOf={parserIdOf}
      onExport={onExport}
      onClearAppData={onClearAppData}
      histogramData={histogramData}
      stats={stats}
    />
  );
};
