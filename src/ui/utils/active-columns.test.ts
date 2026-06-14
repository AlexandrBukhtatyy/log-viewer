import { describe, expect, it } from 'vitest';
import type { LogFilter } from '../../core/types/index.ts';
import type { LvColumnPref } from '../../hooks/use-ui-prefs.ts';
import type { LvGroupBy, LvTab } from '../contracts/lv-types.ts';
import {
  applyTabRules,
  extractTabRules,
  resolveActiveColumns,
  resolveActiveCoreFilter,
  resolveActiveGroupBy,
} from './active-columns.ts';

const col = (key: string, widthPx = 140): LvColumnPref => ({ key, widthPx });

const tab = (id: string, columns?: ReadonlyArray<LvColumnPref>): LvTab => ({
  id,
  name: id,
  kind: 'app',
  ...(columns ? { columns } : {}),
});

const baseFilter: LogFilter = {
  levels: null,
  query: '',
  queryMode: 'substring',
  caseSensitive: false,
  wholeWord: false,
  timeRange: null,
  sources: null,
  services: null,
  filePaths: null,
};

const mkFilter = (over: Partial<LogFilter> = {}): LogFilter => ({
  ...baseFilter,
  ...over,
});

describe('resolveActiveColumns', () => {
  it('returns the global columns for the __all__ tab', () => {
    const global = [col('@level'), col('msg')];
    expect(
      resolveActiveColumns('__all__', [tab('src1', [col('status')])], global),
    ).toBe(global);
  });

  it('returns tab.columns when the active tab has them', () => {
    const global = [col('@level')];
    const tabs = [
      tab('nginx', [col('method'), col('status'), col('request_uri')]),
    ];
    expect(resolveActiveColumns('nginx', tabs, global)).toEqual([
      col('method'),
      col('status'),
      col('request_uri'),
    ]);
  });

  it('falls back to the global columns when tab.columns is absent', () => {
    const global = [col('@level')];
    const tabs = [tab('plain-text-file')]; // no columns field
    expect(resolveActiveColumns('plain-text-file', tabs, global)).toBe(global);
  });

  it('falls back when the activeTabId is unknown (no matching tab)', () => {
    const global = [col('@level')];
    expect(
      resolveActiveColumns('ghost', [tab('other', [col('x')])], global),
    ).toBe(global);
  });

  it('returns an empty array when tab.columns is explicitly empty', () => {
    // Empty columns is a meaningful choice (user cleared the picker on this
    // tab). It must NOT fall back to the global set — that would silently
    // re-introduce columns the user deleted.
    const global = [col('@level')];
    const tabs = [tab('cleared', [])];
    expect(resolveActiveColumns('cleared', tabs, global)).toEqual([]);
  });
});

const fileTab = (id: string, over: Partial<LvTab> = {}): LvTab => ({
  id,
  name: id,
  kind: 'app',
  ...over,
});

describe('resolveActiveGroupBy', () => {
  const global: ReadonlyArray<LvGroupBy> = ['@level'];

  it('returns the global group-by for the __all__ tab', () => {
    expect(
      resolveActiveGroupBy(
        '__all__',
        [fileTab('a', { groupBy: ['service'] })],
        global,
      ),
    ).toBe(global);
  });

  it('returns tab.groupBy when present', () => {
    const tabs = [fileTab('a', { groupBy: ['service'] })];
    expect(resolveActiveGroupBy('a', tabs, global)).toEqual(['service']);
  });

  it('falls back to global when tab.groupBy is absent', () => {
    expect(resolveActiveGroupBy('a', [fileTab('a')], global)).toBe(global);
  });

  it('honours an explicitly-empty tab.groupBy (grouping off)', () => {
    const tabs = [fileTab('a', { groupBy: [] })];
    expect(resolveActiveGroupBy('a', tabs, global)).toEqual([]);
  });
});

describe('resolveActiveCoreFilter', () => {
  const global = mkFilter({ query: 'global' });

  it('returns the global filter for the __all__ tab', () => {
    const tabs = [fileTab('a', { filter: mkFilter({ query: 'tab' }) })];
    expect(resolveActiveCoreFilter('__all__', tabs, global)).toBe(global);
  });

  it('returns tab.filter when present', () => {
    const tabFilter = mkFilter({ query: 'tab' });
    const tabs = [fileTab('a', { filter: tabFilter })];
    expect(resolveActiveCoreFilter('a', tabs, global)).toBe(tabFilter);
  });

  it('falls back to global when tab.filter is absent', () => {
    expect(resolveActiveCoreFilter('a', [fileTab('a')], global)).toBe(global);
  });
});

describe('extractTabRules', () => {
  const globalFilter = mkFilter({ query: 'g' });
  const globalGroup: ReadonlyArray<LvGroupBy> = ['@level'];

  it('reads global rules for the __all__ source', () => {
    const rules = extractTabRules('__all__', [], globalFilter, globalGroup);
    expect(rules.filter).toEqual(globalFilter);
    expect(rules.groupBy).toBe(globalGroup);
    expect(rules.sortBy).toBeUndefined();
  });

  it('reads per-tab overrides and the per-tab sort', () => {
    const tabs = [
      fileTab('a', {
        filter: mkFilter({ query: 'tab' }),
        groupBy: ['service'],
        sortBy: { key: '@ts', dir: 'desc' },
      }),
    ];
    const rules = extractTabRules('a', tabs, globalFilter, globalGroup);
    expect(rules.filter.query).toBe('tab');
    expect(rules.groupBy).toEqual(['service']);
    expect(rules.sortBy).toEqual({ key: '@ts', dir: 'desc' });
  });

  it('strips scope from the extracted filter', () => {
    const tabs = [
      fileTab('a', {
        filter: mkFilter({
          sources: ['s1'],
          filePaths: ['/x'],
        } as unknown as Partial<LogFilter>),
      }),
    ];
    const rules = extractTabRules('a', tabs, globalFilter, globalGroup);
    expect(rules.filter.sources).toBeNull();
    expect(rules.filter.filePaths).toBeNull();
  });
});

describe('applyTabRules', () => {
  const rules = {
    filter: mkFilter({ query: 'src' }),
    groupBy: ['service'] as ReadonlyArray<LvGroupBy>,
    sortBy: { key: '@ts', dir: 'asc' } as LvTab['sortBy'],
  };

  it('writes rules onto the targeted tabs only', () => {
    const tabs = [fileTab('a'), fileTab('b'), fileTab('c')];
    const next = applyTabRules(tabs, new Set(['a', 'c']), rules);
    expect(next[0].filter?.query).toBe('src');
    expect(next[0].groupBy).toEqual(['service']);
    expect(next[0].sortBy).toEqual({ key: '@ts', dir: 'asc' });
    expect(next[1]).toBe(tabs[1]); // untouched, same reference
    expect(next[2].filter?.query).toBe('src');
  });

  it('never touches the __all__ aggregate even if targeted', () => {
    const tabs = [{ id: '__all__', name: 'All' } as LvTab, fileTab('a')];
    const next = applyTabRules(tabs, new Set(['__all__', 'a']), rules);
    expect(next[0]).toBe(tabs[0]);
    expect(next[1].filter?.query).toBe('src');
  });

  it('nulls scope on the written filter', () => {
    const withScope = {
      ...rules,
      filter: mkFilter({
        sources: ['s1'],
        filePaths: ['/x'],
      } as unknown as Partial<LogFilter>),
    };
    const next = applyTabRules([fileTab('a')], new Set(['a']), withScope);
    expect(next[0].filter?.sources).toBeNull();
    expect(next[0].filter?.filePaths).toBeNull();
  });
});
