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

  it('emits one catalog root per source, preserving order', () => {
    const tree = buildCatalogTree([
      fileSource('s-1', 'a.log'),
      fileSource('s-2', 'b.log'),
      streamSource('s-3', 'kafka', 10),
      k8sSource('s-4', 'api-pod'),
    ]);
    expect(tree).toHaveLength(4);
    expect(tree.map((r) => r.id)).toEqual(['s-1', 's-2', 's-3', 's-4']);
    // Every root carries `root: true` and a source kind for the icon.
    for (const r of tree) {
      expect(r.root).toBe(true);
      expect(typeof r.source).toBe('string');
    }
  });

  it('classifies file/text → local-static, stream → stream, k8s → k8s', () => {
    const tree = buildCatalogTree([
      fileSource('s-1', 'a.log'),
      streamSource('s-2', 'kafka'),
      k8sSource('s-3', 'api-pod'),
    ]);
    expect(tree.find((r) => r.id === 's-1')?.source).toBe('local-static');
    expect(tree.find((r) => r.id === 's-2')?.source).toBe('stream');
    expect(tree.find((r) => r.id === 's-3')?.source).toBe('k8s');
  });

  it('marks streaming sources live with newCount on the root file-leaf', () => {
    const tree = buildCatalogTree([streamSource('s-1', 'kafka', 42)]);
    const root = tree[0] as { type: string; live?: boolean; newCount?: number };
    expect(root.type).toBe('file');
    expect(root.live).toBe(true);
    expect(root.newCount).toBe(42);
  });

  it('done sources expose entryCount as `count` on the root', () => {
    const tree = buildCatalogTree([fileSource('s-1', 'a.log')]);
    const root = tree[0] as { type: string; count?: number };
    expect(root.type).toBe('file');
    expect(root.count).toBe(0);
  });

  it('static directories pick the local-static glyph', () => {
    const tree = buildCatalogTree([directorySource('s-1', 'logs', false)]);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.source).toBe('local-static');
  });

  it('watched directories pick the local-live glyph', () => {
    const tree = buildCatalogTree([directorySource('s-1', 'logs', true)]);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.source).toBe('local-live');
  });

  it('directory source without walked tree falls back to a flat root', () => {
    const tree = buildCatalogTree([directorySource('s-1', 'logs')]);
    expect(tree[0]!.type).toBe('file');
    expect(tree[0]!.id).toBe('s-1');
  });

  it('directory source with walked tree exposes children at the root', () => {
    const directoryTrees = {
      's-1': {
        id: 's-1',
        type: 'folder' as const,
        name: 'logs',
        children: [
          {
            id: 's-1::a.log',
            type: 'file' as const,
            name: 'a.log',
            kind: 'app' as const,
          },
        ],
      },
    };
    const tree = buildCatalogTree(
      [directorySource('s-1', 'logs')],
      directoryTrees,
    );
    expect(tree[0]!.type).toBe('folder');
    expect(tree[0]!.id).toBe('s-1');
    const folder = tree[0] as { children: unknown[] };
    expect(folder.children).toHaveLength(1);
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
