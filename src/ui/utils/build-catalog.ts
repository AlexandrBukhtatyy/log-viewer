import type {
  LogSourceKind,
  SourceRecord,
  SourceStatus,
} from '../../core/types/index.ts';
import type {
  LvCatalogRoot,
  LvFileNode,
  LvFolderNode,
  LvLogKind,
  LvSourceKind,
} from '../contracts/lv-types.ts';

/**
 * Synthetic catalog tree for the sidebar — one root per UI source-kind, each
 * containing the matching live `SourceRecord`s as file nodes. This is a
 * presentation-only mapping; entry data still flows through the core
 * windowed contract (`useLogWindow`).
 *
 * Phase 4 may replace this with directory hierarchy from `dirHandle` for
 * `directory` sources.
 */

const CORE_TO_LV: Record<LogSourceKind, LvSourceKind> = {
  file: 'local-static',
  directory: 'local-static',
  text: 'local-static',
  url: 'cloud',
  stream: 'stream',
  'remote-ssh': 'remote-ssh',
  cloud: 'cloud',
  k8s: 'k8s',
  bus: 'bus',
  db: 'db',
  snapshot: 'snapshot',
};

const ROOT_LABEL: Record<LvSourceKind, string> = {
  'local-static': 'Local files',
  'local-live': 'Watched folders',
  'remote-ssh': 'SSH remotes',
  stream: 'Streams',
  cloud: 'Cloud providers',
  k8s: 'Kubernetes',
  bus: 'Message buses',
  db: 'Databases',
  snapshot: 'Snapshots',
  bookmark: 'Saved views',
};

const FILE_KIND: Record<LogSourceKind, LvLogKind> = {
  file: 'app',
  directory: 'app',
  text: 'text',
  url: 'app',
  stream: 'app',
  'remote-ssh': 'app',
  cloud: 'app',
  k8s: 'k8s',
  bus: 'json',
  db: 'app',
  snapshot: 'app',
};

const isLive = (status: SourceStatus): boolean =>
  status.kind === 'streaming' ||
  status.kind === 'indexing' ||
  status.kind === 'loading';

const newCountOf = (status: SourceStatus): number | undefined => {
  if (status.kind === 'streaming') return status.entriesIndexed;
  return undefined;
};

const statusLabel = (status: SourceStatus): string | undefined => {
  if (status.kind === 'idle') return undefined;
  return status.kind;
};

const fileNodeFromSource = (record: SourceRecord): LvFileNode => ({
  id: record.source.id,
  type: 'file',
  name: record.source.name,
  kind: FILE_KIND[record.source.kind],
  live: isLive(record.status),
  newCount: newCountOf(record.status),
  count: record.status.kind === 'done' ? record.status.entryCount : undefined,
});

export const buildCatalogTree = (
  sources: ReadonlyArray<SourceRecord>,
): LvCatalogRoot[] => {
  const buckets = new Map<LvSourceKind, LvFileNode[]>();
  for (const rec of sources) {
    const lvKind = CORE_TO_LV[rec.source.kind];
    const list = buckets.get(lvKind) ?? [];
    list.push(fileNodeFromSource(rec));
    buckets.set(lvKind, list);
  }
  const roots: LvCatalogRoot[] = [];
  for (const [lvKind, files] of buckets) {
    const folder: LvFolderNode = {
      id: `lv-root-${lvKind}`,
      type: 'folder',
      name: ROOT_LABEL[lvKind],
      source: lvKind,
      open: true,
      status: files.some((f) => f.live) ? 'streaming' : undefined,
      children: files,
    };
    roots.push(folder as LvCatalogRoot);
  }
  return roots;
};

export const filesByIdFromSources = (
  sources: ReadonlyArray<SourceRecord>,
): Record<string, LvFileNode> => {
  const out: Record<string, LvFileNode> = {};
  for (const rec of sources) out[rec.source.id] = fileNodeFromSource(rec);
  return out;
};

/** Status badge text for a source (loading/indexing/done/error/...). */
export const sourceStatusBadge = (status: SourceStatus): string =>
  statusLabel(status) ?? '';
