import { useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { LogFilter } from '../core/types/index.ts';
import { EMPTY_FILTER } from '../core/types/index.ts';
// Type-only imports from ui/ are allowed for hooks (eslint.config.js RULES_HOOKS).
import type { LvGroupBy, LvTab } from '../ui/contracts/lv-types.ts';

/**
 * Workspace = the user's working session — tabs, selection, filter, group-by,
 * live-tail. Persisted across page reload via `localStorage['lv:workspace']`.
 * UI tweaks (theme, density, columns) live in `lv:ui-prefs`; this store is
 * specifically the per-task state the user expects to come back to.
 *
 * The contract is intentionally small: setters live inside the store with
 * stable refs, hydration is synchronous via zustand v5's localStorage adapter
 * (so `hydrated` flips to `true` before the first React render), and stale
 * references to deleted sources are pruned by `removeSource` /
 * `pruneMissingSources` rather than at read time.
 */

/** localStorage key. Exported so tests can clear it. */
export const WORKSPACE_STORAGE_KEY = 'lv:workspace';
const STORAGE_VERSION = 1;

/** Snapshot of the workspace that survives reload. `sources` and `filePaths`
 *  are stripped from the persisted filter — they're derived from selection
 *  and tabs, so persisting them would freeze stale source-ids into the
 *  filter and confuse the next session. */
export interface WorkspacePersistedV1 {
  readonly version: 1;
  readonly openTabs: ReadonlyArray<LvTab>;
  readonly activeTabId: string;
  readonly selectedIds: ReadonlyArray<string>;
  readonly coreFilter: LogFilter;
  readonly groupBy: ReadonlyArray<LvGroupBy>;
  readonly liveTail: boolean;
}

interface WorkspaceStoreState {
  openTabs: ReadonlyArray<LvTab>;
  activeTabId: string;
  selectedIds: Set<string>;
  coreFilter: LogFilter;
  groupBy: ReadonlyArray<LvGroupBy>;
  liveTail: boolean;
  /** `true` once `persist().onFinishHydration` has fired. For zustand v5
   *  localStorage the hydration is synchronous, so this is effectively
   *  `true` by the first React render — the flag still exists so callers
   *  can wait when they need a hard guarantee (e.g. one-shot prune
   *  effect in LvAppContainer). */
  _hydrated: boolean;

  setOpenTabs(
    updater: (prev: ReadonlyArray<LvTab>) => ReadonlyArray<LvTab>,
  ): void;
  setActiveTabId(id: string): void;
  setSelectedIds(updater: (prev: Set<string>) => Set<string>): void;
  setCoreFilter(updater: (prev: LogFilter) => LogFilter): void;
  setGroupBy(next: ReadonlyArray<LvGroupBy>): void;
  setLiveTail(v: boolean): void;
  /** Single-operation cleanup after the user removes a source: drop its plain
   *  id and any `<sourceId>::<path>` compound from `selectedIds` and
   *  `openTabs`, collapse `activeTabId` to `'__all__'` if it pointed at the
   *  removed source. Used by the container's `onRemoveRoot`. */
  removeSource(sourceId: string): void;
  /** Drop entries from `selectedIds` and `openTabs` whose base source-id
   *  isn't in `liveSourceIds`. Called once after both source-hydration and
   *  workspace-hydration complete — covers the case where a source was
   *  removed in a previous session while it was still referenced. */
  pruneMissingSources(liveSourceIds: ReadonlySet<string>): void;
}

const initialState = {
  openTabs: [] as ReadonlyArray<LvTab>,
  activeTabId: '__all__',
  selectedIds: new Set<string>(),
  coreFilter: EMPTY_FILTER,
  groupBy: [] as ReadonlyArray<LvGroupBy>,
  liveTail: false,
  _hydrated: false,
};

const baseSourceIdOf = (compound: string): string => {
  const sep = compound.indexOf('::');
  return sep === -1 ? compound : compound.slice(0, sep);
};

/** Data subset of `WorkspaceStoreState` used by serialization helpers and
 *  exposed in tests. */
export interface WorkspaceData {
  openTabs: ReadonlyArray<LvTab>;
  activeTabId: string;
  selectedIds: Set<string>;
  coreFilter: LogFilter;
  groupBy: ReadonlyArray<LvGroupBy>;
  liveTail: boolean;
}

/** Serialize the live workspace state for `localStorage`. Strips `sources`
 *  and `filePaths` from the filter (derived from selection / tabs, would
 *  freeze stale ids); converts the `selectedIds` Set to a sorted array
 *  for deterministic output. */
export const partializeWorkspace = (
  s: WorkspaceData,
): WorkspacePersistedV1 => ({
  version: 1,
  openTabs: s.openTabs,
  activeTabId: s.activeTabId,
  selectedIds: [...s.selectedIds].sort(),
  coreFilter: { ...s.coreFilter, sources: null, filePaths: null },
  groupBy: s.groupBy,
  liveTail: s.liveTail,
});

/** Rehydrate the workspace from a persisted snapshot. Tolerant of missing
 *  / wrong-typed fields — corrupted JSON yields defaults rather than
 *  throwing. The return value is a `WorkspaceData` shape; the full store
 *  state stays untouched in `current` and is restored by `Object.assign`
 *  at the call site. */
export const mergeWorkspaceData = (
  persisted: unknown,
  current: WorkspaceData,
): WorkspaceData => {
  if (!persisted || typeof persisted !== 'object') return current;
  const p = persisted as Partial<WorkspacePersistedV1>;
  const selectedIdsRaw = p.selectedIds;
  const selectedIds = Array.isArray(selectedIdsRaw)
    ? new Set<string>(
        selectedIdsRaw.filter((x): x is string => typeof x === 'string'),
      )
    : new Set<string>();
  const tabsRaw = p.openTabs;
  const openTabs: ReadonlyArray<LvTab> = Array.isArray(tabsRaw)
    ? (tabsRaw.filter(
        (t): t is LvTab =>
          !!t && typeof t === 'object' && typeof (t as LvTab).id === 'string',
      ) as ReadonlyArray<LvTab>)
    : [];
  return {
    openTabs,
    activeTabId: typeof p.activeTabId === 'string' ? p.activeTabId : '__all__',
    selectedIds,
    coreFilter: {
      ...EMPTY_FILTER,
      ...(p.coreFilter ?? {}),
      sources: null,
      filePaths: null,
    },
    groupBy: Array.isArray(p.groupBy)
      ? (p.groupBy.filter(
          (x): x is LvGroupBy => typeof x === 'string',
        ) as ReadonlyArray<LvGroupBy>)
      : [],
    liveTail: typeof p.liveTail === 'boolean' ? p.liveTail : false,
  };
};

const stripSelection = (
  ids: ReadonlySet<string>,
  sourceId: string,
): Set<string> => {
  const prefix = `${sourceId}::`;
  const next = new Set<string>();
  for (const id of ids) {
    if (id === sourceId) continue;
    if (id.startsWith(prefix)) continue;
    next.add(id);
  }
  return next;
};

const stripTabs = (
  tabs: ReadonlyArray<LvTab>,
  sourceId: string,
): ReadonlyArray<LvTab> => {
  const prefix = `${sourceId}::`;
  return tabs.filter((t) => t.id !== sourceId && !t.id.startsWith(prefix));
};

export const useWorkspaceStore = create<WorkspaceStoreState>()(
  persist(
    (set, get) => ({
      ...initialState,

      setOpenTabs: (updater) => set({ openTabs: updater(get().openTabs) }),
      setActiveTabId: (id) => set({ activeTabId: id }),
      setSelectedIds: (updater) =>
        set({ selectedIds: updater(get().selectedIds) }),
      setCoreFilter: (updater) =>
        set({ coreFilter: updater(get().coreFilter) }),
      setGroupBy: (next) => set({ groupBy: next }),
      setLiveTail: (v) => set({ liveTail: v }),

      removeSource: (sourceId) => {
        const s = get();
        const selectedIds = stripSelection(s.selectedIds, sourceId);
        const openTabs = stripTabs(s.openTabs, sourceId);
        const activeTabId =
          s.activeTabId === sourceId ||
          s.activeTabId.startsWith(`${sourceId}::`)
            ? '__all__'
            : s.activeTabId;
        set({ selectedIds, openTabs, activeTabId });
      },

      pruneMissingSources: (liveSourceIds) => {
        const s = get();
        const selectedIds = new Set<string>();
        for (const id of s.selectedIds) {
          if (liveSourceIds.has(baseSourceIdOf(id))) selectedIds.add(id);
        }
        const openTabs = s.openTabs.filter((t) =>
          liveSourceIds.has(baseSourceIdOf(t.id)),
        );
        const activeStillThere =
          s.activeTabId === '__all__' ||
          liveSourceIds.has(baseSourceIdOf(s.activeTabId));
        const activeTabId = activeStillThere ? s.activeTabId : '__all__';
        set({ selectedIds, openTabs, activeTabId });
      },
    }),
    {
      name: WORKSPACE_STORAGE_KEY,
      version: STORAGE_VERSION,
      partialize: (s) => partializeWorkspace(s),
      merge: (persisted, current) => {
        const data = mergeWorkspaceData(persisted, current as WorkspaceData);
        return { ...(current as WorkspaceStoreState), ...data };
      },
      // Stub under version: 1 baseline. Future bumps slot their migration
      // logic here; the persist runtime invokes this before `merge`.
      migrate: (state) => state,
    },
  ),
);

// zustand v5 + localStorage hydrates synchronously, so this listener fires
// before the first React render. The flag is still useful as a one-shot
// gate for prune-on-startup effects that depend on both source hydration
// and workspace hydration landing. Guard against the no-storage case
// (vitest in `node` environment) so module evaluation doesn't crash —
// the action-level tests don't need the hydration flag.
if (useWorkspaceStore.persist) {
  useWorkspaceStore.persist.onFinishHydration(() => {
    useWorkspaceStore.setState({ _hydrated: true });
  });
  if (useWorkspaceStore.persist.hasHydrated()) {
    useWorkspaceStore.setState({ _hydrated: true });
  }
} else {
  // No persist middleware (test env without localStorage) — pretend
  // hydration completed so consumers gating on the flag still proceed.
  useWorkspaceStore.setState({ _hydrated: true });
}

export interface UseWorkspace {
  readonly openTabs: ReadonlyArray<LvTab>;
  readonly activeTabId: string;
  readonly selectedIds: ReadonlySet<string>;
  readonly coreFilter: LogFilter;
  readonly groupBy: ReadonlyArray<LvGroupBy>;
  readonly liveTail: boolean;
  readonly hydrated: boolean;

  setOpenTabs: WorkspaceStoreState['setOpenTabs'];
  setActiveTabId: WorkspaceStoreState['setActiveTabId'];
  setSelectedIds: WorkspaceStoreState['setSelectedIds'];
  setCoreFilter: WorkspaceStoreState['setCoreFilter'];
  setGroupBy: WorkspaceStoreState['setGroupBy'];
  setLiveTail: WorkspaceStoreState['setLiveTail'];
  removeSource: WorkspaceStoreState['removeSource'];
  pruneMissingSources: WorkspaceStoreState['pruneMissingSources'];
}

export const useWorkspace = (): UseWorkspace => {
  const openTabs = useWorkspaceStore((s) => s.openTabs);
  const activeTabId = useWorkspaceStore((s) => s.activeTabId);
  const selectedIdsRaw = useWorkspaceStore((s) => s.selectedIds);
  const coreFilter = useWorkspaceStore((s) => s.coreFilter);
  const groupBy = useWorkspaceStore((s) => s.groupBy);
  const liveTail = useWorkspaceStore((s) => s.liveTail);
  const hydrated = useWorkspaceStore((s) => s._hydrated);

  const setOpenTabs = useWorkspaceStore((s) => s.setOpenTabs);
  const setActiveTabId = useWorkspaceStore((s) => s.setActiveTabId);
  const setSelectedIds = useWorkspaceStore((s) => s.setSelectedIds);
  const setCoreFilter = useWorkspaceStore((s) => s.setCoreFilter);
  const setGroupBy = useWorkspaceStore((s) => s.setGroupBy);
  const setLiveTail = useWorkspaceStore((s) => s.setLiveTail);
  const removeSource = useWorkspaceStore((s) => s.removeSource);
  const pruneMissingSources = useWorkspaceStore((s) => s.pruneMissingSources);

  // Mirror selectedIds Set into a stable ReadonlySet so consumers can use
  // `.has(...)` ergonomically. The Set in the store is rebuilt on every
  // mutating action, so identity tracks the underlying value.
  const selectedIds = useMemo<ReadonlySet<string>>(
    () => selectedIdsRaw,
    [selectedIdsRaw],
  );

  return {
    openTabs,
    activeTabId,
    selectedIds,
    coreFilter,
    groupBy,
    liveTail,
    hydrated,
    setOpenTabs,
    setActiveTabId,
    setSelectedIds,
    setCoreFilter,
    setGroupBy,
    setLiveTail,
    removeSource,
    pruneMissingSources,
  };
};
