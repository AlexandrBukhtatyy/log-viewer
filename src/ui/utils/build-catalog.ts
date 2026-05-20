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
  LvSourceKind,
} from '../contracts/lv-types.ts';

/**
 * Catalog tree for the sidebar — one root per ingested source. Directory
 * sources expand into a real folder tree (via `directoryTrees`); other
 * sources stay as a single root file-leaf.
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
 * Map a core source to its sidebar source-kind for icon selection. Mostly
 * identity via CORE_TO_LV, but `directory` splits by the `watch` flag —
 * watched folders use the "Watched folders" glyph, static ones use "Local files".
 */
const lvKindOf = (source: LogSource): LvSourceKind => {
  if (source.kind === 'directory' && source.watch) return 'local-live';
  return CORE_TO_LV[source.kind];
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
  status.kind === 'queued' ||
  status.kind === 'streaming' ||
  status.kind === 'indexing' ||
  status.kind === 'loading';

const newCountOf = (status: SourceStatus): number | undefined => {
  if (status.kind === 'streaming') return status.entriesIndexed;
  return undefined;
};

const formatPercent = (read: number, total: number): string | undefined => {
  if (total <= 0) return undefined;
  const pct = Math.min(100, Math.max(0, Math.round((read / total) * 100)));
  return `${pct}%`;
};

const progressLabelOf = (status: SourceStatus): string | undefined => {
  if (status.kind === 'queued') return '…';
  if (status.kind === 'loading') {
    if (status.bytesRead !== undefined && status.bytesTotal !== undefined) {
      return formatPercent(status.bytesRead, status.bytesTotal) ?? '…';
    }
    return '…';
  }
  if (status.kind === 'indexing') {
    if (status.bytesRead !== undefined && status.bytesTotal !== undefined) {
      const pct = formatPercent(status.bytesRead, status.bytesTotal);
      if (pct !== undefined) return pct;
    }
    const n = status.entriesIndexed;
    return n > 0 ? n.toLocaleString() : '…';
  }
  if (status.kind === 'streaming') {
    const n = status.entriesIndexed;
    return n > 0 ? n.toLocaleString() : '…';
  }
  return undefined;
};

const progressTitleOf = (status: SourceStatus): string | undefined => {
  switch (status.kind) {
    case 'queued':
      return 'Queued for ingest';
    case 'loading':
      return status.bytesTotal !== undefined
        ? 'Loading — % of source bytes read'
        : 'Loading source';
    case 'indexing':
      return status.bytesTotal !== undefined
        ? 'Indexing — % of source bytes processed'
        : `Indexing — ${status.entriesIndexed.toLocaleString()} entries parsed`;
    case 'streaming':
      return `Streaming — ${status.entriesIndexed.toLocaleString()} new entries`;
    default:
      return undefined;
  }
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
  progressTitle: progressTitleOf(record.status),
  parserId: record.parserId,
});

/**
 * For a `directory` source, return its real file tree as a catalog root if
 * `useDirectoryTrees` has finished walking the handle; otherwise fall back to
 * the flat file-leaf root. The folder variant keeps source-derived flags
 * (live, count, needsPermission, …) on its top-level metadata so the sidebar
 * still surfaces ingest status at the source root.
 */
const directoryRoot = (
  rec: SourceRecord,
  directoryTrees: Readonly<Record<string, LvFolderNode>>,
  lvKind: LvSourceKind,
): LvCatalogRoot => {
  const tree = directoryTrees[rec.source.id];
  const flat = fileNodeFromSource(rec);
  if (!tree) {
    return { ...flat, root: true, source: lvKind };
  }
  return {
    ...tree,
    id: rec.source.id,
    name: rec.source.name,
    root: true,
    source: lvKind,
    open: tree.open ?? true,
    status: flat.live
      ? 'streaming'
      : rec.status.kind === 'permission-required'
        ? 'permission-required'
        : undefined,
    live: flat.live,
    progressLabel: flat.progressLabel,
    progressTitle: flat.progressTitle,
    parserId: rec.parserId,
    children: tree.children,
  };
};

export const buildCatalogTree = (
  sources: ReadonlyArray<SourceRecord>,
  directoryTrees: Readonly<Record<string, LvFolderNode>> = {},
): LvCatalogRoot[] => {
  const roots: LvCatalogRoot[] = [];
  for (const rec of sources) {
    const lvKind = lvKindOf(rec.source);
    if (rec.source.kind === 'directory') {
      roots.push(directoryRoot(rec, directoryTrees, lvKind));
      continue;
    }
    const flat = fileNodeFromSource(rec);
    roots.push({ ...flat, root: true, source: lvKind });
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
