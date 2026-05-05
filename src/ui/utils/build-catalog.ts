import type {
  LogSource,
  LogSourceKind,
  SourceRecord,
  SourceStatus,
} from '../../core/types/index.ts';
import type {
  LvCatalogRoot,
  LvFileNode,
  LvFolderNode,
  LvLogKind,
  LvNode,
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

/**
 * Map a core source to its sidebar tree section. Mostly identity via
 * CORE_TO_LV, but `directory` splits by the `watch` flag — watched folders
 * land under "Watched folders", static ones under "Local files".
 */
const lvKindOf = (source: LogSource): LvSourceKind => {
  if (source.kind === 'directory' && source.watch) return 'local-live';
  return CORE_TO_LV[source.kind];
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

const progressLabelOf = (status: SourceStatus): string | undefined => {
  if (status.kind === 'loading') return 'loading…';
  if (status.kind === 'indexing') {
    const n = status.entriesIndexed;
    return n > 0 ? `indexing ${n.toLocaleString()}` : 'indexing…';
  }
  if (status.kind === 'streaming') {
    const n = status.entriesIndexed;
    return n > 0 ? `streaming ${n.toLocaleString()}` : 'streaming…';
  }
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
  needsPermission: record.status.kind === 'permission-required',
  errorMessage:
    record.status.kind === 'error' ? record.status.error.message : undefined,
  progressLabel: progressLabelOf(record.status),
});

/**
 * For a `directory` source, return its real file tree if `useDirectoryTrees`
 * has finished walking the handle; otherwise fall back to the flat file
 * node. The returned folder keeps source-derived flags (live, count,
 * needsPermission, …) on its top-level metadata so the UI's
 * "Local files / Watched folders" root still surfaces ingest status.
 */
const directoryNode = (
  rec: SourceRecord,
  directoryTrees: Readonly<Record<string, LvFolderNode>>,
): LvNode => {
  const tree = directoryTrees[rec.source.id];
  const flat = fileNodeFromSource(rec);
  if (!tree) return flat;
  // Merge — propagate source-level live/count signals onto the directory's
  // root folder node, while keeping the walked children intact. `sourceKind`
  // marks this node as "the root of an external source" so LvTreeNode
  // renders a source-specific icon, distinguishing it from internal
  // sub-folders.
  return {
    ...tree,
    name: rec.source.name,
    open: tree.open ?? true,
    status: flat.live
      ? 'streaming'
      : rec.status.kind === 'permission-required'
        ? 'permission-required'
        : undefined,
    live: flat.live,
    progressLabel: flat.progressLabel,
    sourceKind: lvKindOf(rec.source),
    children: tree.children,
  } satisfies LvFolderNode;
};

export const buildCatalogTree = (
  sources: ReadonlyArray<SourceRecord>,
  directoryTrees: Readonly<Record<string, LvFolderNode>> = {},
): LvCatalogRoot[] => {
  const buckets = new Map<LvSourceKind, LvNode[]>();
  for (const rec of sources) {
    const lvKind = lvKindOf(rec.source);
    const node: LvNode =
      rec.source.kind === 'directory'
        ? directoryNode(rec, directoryTrees)
        : fileNodeFromSource(rec);
    const list = buckets.get(lvKind) ?? [];
    list.push(node);
    buckets.set(lvKind, list);
  }
  const roots: LvCatalogRoot[] = [];
  for (const [lvKind, children] of buckets) {
    const folder: LvFolderNode = {
      id: `lv-root-${lvKind}`,
      type: 'folder',
      name: ROOT_LABEL[lvKind],
      source: lvKind,
      open: true,
      status: children.some(
        (c) => c.type === 'file' && c.live,
      )
        ? 'streaming'
        : undefined,
      children,
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
