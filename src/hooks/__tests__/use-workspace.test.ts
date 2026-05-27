import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_FILTER, type LogFilter } from '../../core/types/index.ts';
import type { LvGroupBy, LvTab } from '../../ui/contracts/lv-types.ts';
import {
  WORKSPACE_STORAGE_KEY,
  mergeWorkspaceData,
  partializeWorkspace,
  useWorkspaceStore,
  type WorkspaceData,
} from '../use-workspace.ts';

const baseState = (over: Partial<WorkspaceData> = {}): WorkspaceData => ({
  openTabs: [],
  activeTabId: '__all__',
  selectedIds: new Set<string>(),
  coreFilter: EMPTY_FILTER,
  groupBy: [],
  liveTail: false,
  ...over,
});

const sampleTab = (id: string, name: string = id): LvTab => ({
  id,
  name,
  kind: 'app',
});

// In-memory localStorage polyfill — vitest runs in node by default, no DOM.
// Only the methods touched by the persist middleware are stubbed.
class MemoryStorage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  key(i: number): string | null {
    return [...this.store.keys()][i] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
});

afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe('partializeWorkspace', () => {
  it('strips sources/filePaths from coreFilter and sorts selectedIds', () => {
    const result = partializeWorkspace(
      baseState({
        selectedIds: new Set(['c', 'a', 'b']),
        coreFilter: {
          ...EMPTY_FILTER,
          query: 'oom',
          sources: ['s1' as never],
          filePaths: ['x.log'],
        } as LogFilter,
      }),
    );
    expect(result.selectedIds).toEqual(['a', 'b', 'c']);
    expect(result.coreFilter.sources).toBeNull();
    expect(result.coreFilter.filePaths).toBeNull();
    expect(result.coreFilter.query).toBe('oom');
    expect(result.version).toBe(1);
  });
});

describe('mergeWorkspaceData', () => {
  it('restores Set and fills defaults for missing fields', () => {
    const data = mergeWorkspaceData(
      {
        version: 1,
        openTabs: [sampleTab('s1')],
        activeTabId: 's1',
        selectedIds: ['s1', 's2'],
      },
      baseState(),
    );
    expect(data.selectedIds).toBeInstanceOf(Set);
    expect([...data.selectedIds].sort()).toEqual(['s1', 's2']);
    expect(data.openTabs).toHaveLength(1);
    expect(data.activeTabId).toBe('s1');
    expect(data.coreFilter).toEqual({ ...EMPTY_FILTER, sources: null, filePaths: null });
    expect(data.liveTail).toBe(false);
    expect(data.groupBy).toEqual([]);
  });

  it('returns current state when persisted is null/undefined', () => {
    const current = baseState({ activeTabId: 'keepme' });
    expect(mergeWorkspaceData(null, current)).toBe(current);
    expect(mergeWorkspaceData(undefined, current)).toBe(current);
  });

  it('survives a corrupted blob with wrong-typed fields', () => {
    const data = mergeWorkspaceData(
      {
        selectedIds: 'oops' as never,
        openTabs: 42 as never,
        activeTabId: 99 as never,
        groupBy: { bad: true } as never,
        liveTail: 'yes' as never,
      },
      baseState(),
    );
    expect(data.selectedIds.size).toBe(0);
    expect(data.openTabs).toEqual([]);
    expect(data.activeTabId).toBe('__all__');
    expect(data.groupBy).toEqual([]);
    expect(data.liveTail).toBe(false);
  });

  it('drops tabs that are not plain objects with string id', () => {
    const data = mergeWorkspaceData(
      {
        openTabs: [
          sampleTab('s1'),
          null as never,
          { name: 'no-id' } as never,
          sampleTab('s2'),
        ],
      },
      baseState(),
    );
    expect(data.openTabs.map((t) => t.id)).toEqual(['s1', 's2']);
  });

  it('preserves per-tab columns through serialize → merge round-trip', () => {
    // Phase 1.2 of docs/plans/columns-multi-format-impl.md: LvTab.columns
    // is an optional per-tab column profile that must survive reload.
    const tabWithColumns: LvTab = {
      ...sampleTab('nginx', 'access.log'),
      columns: [
        { key: 'method', widthPx: 80 },
        { key: 'status', widthPx: 60 },
        { key: 'request_uri', widthPx: 300 },
      ],
    };
    const partialized = partializeWorkspace(baseState({ openTabs: [tabWithColumns] }));
    // Round-trip through JSON to mirror what `persist` does in localStorage.
    const reparsed = JSON.parse(JSON.stringify(partialized));
    const data = mergeWorkspaceData(reparsed, baseState());
    expect(data.openTabs).toHaveLength(1);
    expect(data.openTabs[0].id).toBe('nginx');
    expect(data.openTabs[0].columns).toEqual(tabWithColumns.columns);
  });
});

describe('useWorkspaceStore actions', () => {
  // The store is a module singleton — reset it to a known shape before
  // every test so individual cases stay independent.
  beforeEach(() => {
    useWorkspaceStore.setState({
      openTabs: [],
      activeTabId: '__all__',
      selectedIds: new Set<string>(),
      coreFilter: EMPTY_FILTER,
      groupBy: [],
      liveTail: false,
    });
  });

  it('removeSource: drops plain id, compound ids, and resets activeTabId when it matched the source', () => {
    useWorkspaceStore.setState({
      selectedIds: new Set(['s1', 's1::a.log', 's1::sub/b.log', 's2']),
      openTabs: [sampleTab('s1'), sampleTab('s1::a.log'), sampleTab('s2')],
      activeTabId: 's1::a.log',
    });
    useWorkspaceStore.getState().removeSource('s1');
    const s = useWorkspaceStore.getState();
    expect([...s.selectedIds].sort()).toEqual(['s2']);
    expect(s.openTabs.map((t) => t.id)).toEqual(['s2']);
    expect(s.activeTabId).toBe('__all__');
  });

  it('removeSource: keeps activeTabId when the removed source is unrelated', () => {
    useWorkspaceStore.setState({
      selectedIds: new Set(['s1', 's2']),
      openTabs: [sampleTab('s1'), sampleTab('s2')],
      activeTabId: 's2',
    });
    useWorkspaceStore.getState().removeSource('s1');
    expect(useWorkspaceStore.getState().activeTabId).toBe('s2');
  });

  it('pruneMissingSources: keeps only entries whose base id is in the live set', () => {
    useWorkspaceStore.setState({
      selectedIds: new Set(['live', 'live::a.log', 'gone', 'gone::b.log']),
      openTabs: [sampleTab('live'), sampleTab('gone'), sampleTab('live::a.log')],
      activeTabId: 'gone::b.log',
    });
    useWorkspaceStore.getState().pruneMissingSources(new Set(['live']));
    const s = useWorkspaceStore.getState();
    expect([...s.selectedIds].sort()).toEqual(['live', 'live::a.log']);
    expect(s.openTabs.map((t) => t.id)).toEqual(['live', 'live::a.log']);
    expect(s.activeTabId).toBe('__all__');
  });

  it("pruneMissingSources: leaves '__all__' active tab alone", () => {
    useWorkspaceStore.setState({
      selectedIds: new Set(['s1', 'gone']),
      openTabs: [],
      activeTabId: '__all__',
    });
    useWorkspaceStore.getState().pruneMissingSources(new Set(['s1']));
    const s = useWorkspaceStore.getState();
    expect(s.activeTabId).toBe('__all__');
    expect([...s.selectedIds]).toEqual(['s1']);
  });

  it('setCoreFilter: receives current filter via updater and persists with sources/filePaths nulled', () => {
    useWorkspaceStore.setState({
      coreFilter: { ...EMPTY_FILTER, query: 'old' },
    });
    let observedPrev: LogFilter | null = null;
    useWorkspaceStore.getState().setCoreFilter((prev) => {
      observedPrev = prev;
      return { ...prev, query: 'new' };
    });
    expect(observedPrev).not.toBeNull();
    expect((observedPrev as unknown as LogFilter).query).toBe('old');
    expect(useWorkspaceStore.getState().coreFilter.query).toBe('new');
  });

  it('setOpenTabs / setActiveTabId: round-trip', () => {
    const t1 = sampleTab('s1');
    useWorkspaceStore.getState().setOpenTabs(() => [t1]);
    useWorkspaceStore.getState().setActiveTabId('s1');
    expect(useWorkspaceStore.getState().openTabs).toEqual([t1]);
    expect(useWorkspaceStore.getState().activeTabId).toBe('s1');
  });

  it('setGroupBy / setLiveTail: simple value setters', () => {
    useWorkspaceStore.getState().setGroupBy(['level'] as ReadonlyArray<LvGroupBy>);
    useWorkspaceStore.getState().setLiveTail(true);
    expect(useWorkspaceStore.getState().groupBy).toEqual(['level']);
    expect(useWorkspaceStore.getState().liveTail).toBe(true);
  });

  it('localStorage key is "lv:workspace" — must stay in sync with clear-app-data.ts', () => {
    expect(WORKSPACE_STORAGE_KEY).toBe('lv:workspace');
  });
});
