import { describe, expect, it } from 'vitest';
import type { SourceId, SourceRecord } from '../../core/types/index.ts';
import { buildCatalogTree, filesByIdFromSources } from './build-catalog.ts';

const fileSource = (id: string, name: string): SourceRecord => ({
  source: {
    kind: 'file',
    id: id as SourceId,
    name,
    size: 0,
    file: new File([''], name),
  },
  status: { kind: 'done', entryCount: 0 },
});

const streamSource = (id: string, name: string, indexed = 0): SourceRecord => ({
  source: {
    kind: 'stream',
    id: id as SourceId,
    name,
    transport: 'ws',
    url: 'wss://example/',
  },
  status: { kind: 'streaming', entriesIndexed: indexed },
});

const directorySource = (
  id: string,
  name: string,
  watch = false,
): SourceRecord => ({
  source: {
    kind: 'directory',
    id: id as SourceId,
    name,
    handle: {} as unknown as FileSystemDirectoryHandle,
    watch,
  },
  status: { kind: 'done', entryCount: 0 },
});

const k8sSource = (id: string, name: string): SourceRecord => ({
  source: {
    kind: 'k8s',
    id: id as SourceId,
    name,
    cluster: 'prod',
  },
  status: { kind: 'error', error: { name: 'NotImplemented', message: 'stub' } },
});

describe('buildCatalogTree', () => {
  it('empty input yields empty roots', () => {
    expect(buildCatalogTree([])).toEqual([]);
  });

  it('groups sources by kind into named root folders', () => {
    const tree = buildCatalogTree([
      fileSource('s-1', 'a.log'),
      fileSource('s-2', 'b.log'),
      streamSource('s-3', 'kafka', 10),
      k8sSource('s-4', 'api-pod'),
    ]);
    expect(tree).toHaveLength(3);
    expect(tree.find((r) => r.source === 'local-static')?.children).toHaveLength(2);
    expect(tree.find((r) => r.source === 'stream')?.children).toHaveLength(1);
    expect(tree.find((r) => r.source === 'k8s')?.children).toHaveLength(1);
  });

  it('marks streaming sources live with newCount', () => {
    const tree = buildCatalogTree([streamSource('s-1', 'kafka', 42)]);
    const file = tree[0]!.children[0] as { live?: boolean; newCount?: number };
    expect(file.live).toBe(true);
    expect(file.newCount).toBe(42);
  });

  it('done sources expose entryCount as `count`', () => {
    const tree = buildCatalogTree([fileSource('s-1', 'a.log')]);
    const file = tree[0]!.children[0] as { count?: number };
    expect(file.count).toBe(0);
  });

  it('static directories land under "Local files"', () => {
    const tree = buildCatalogTree([directorySource('s-1', 'logs', false)]);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.source).toBe('local-static');
  });

  it('watched directories land under "Watched folders"', () => {
    const tree = buildCatalogTree([directorySource('s-1', 'logs', true)]);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.source).toBe('local-live');
  });

  it('mixes static and watched directories into separate roots', () => {
    const tree = buildCatalogTree([
      directorySource('s-1', 'static-logs', false),
      directorySource('s-2', 'live-logs', true),
    ]);
    const sorted = tree.map((r) => r.source).sort();
    expect(sorted).toEqual(['local-live', 'local-static']);
  });
});

describe('filesByIdFromSources', () => {
  it('flat lookup keyed by source id', () => {
    const map = filesByIdFromSources([
      fileSource('s-1', 'a.log'),
      streamSource('s-2', 'kafka'),
    ]);
    expect(Object.keys(map).sort()).toEqual(['s-1', 's-2']);
    expect(map['s-1']?.name).toBe('a.log');
    expect(map['s-2']?.live).toBe(true);
  });
});
