import type { LvFileNode, LvFolderNode } from '../../contracts/lv-types.ts';

const MAP: Record<string, { label: string; cls: string }> = {
  'local-static': { label: 'LOCAL', cls: 'is-neutral' },
  'local-live': { label: 'LIVE', cls: 'is-live' },
  'remote-ssh': { label: 'SSH', cls: 'is-remote' },
  stream: { label: 'STREAM', cls: 'is-live' },
  cloud: { label: 'CLOUD', cls: 'is-cloud' },
  k8s: { label: 'K8S', cls: 'is-k8s' },
  bus: { label: 'BUS', cls: 'is-bus' },
  snapshot: { label: 'SNAPSHOT', cls: 'is-frozen' },
  db: { label: 'DB', cls: 'is-db' },
  bookmark: { label: 'VIEW', cls: 'is-shared' },
};

export interface LvRootBadgeProps {
  /** Catalog top-level node — either the directory's walked tree (folder)
   * or the source's flat root leaf (file). */
  readonly node: LvFolderNode | LvFileNode;
}

export const LvRootBadge = ({ node }: LvRootBadgeProps) => {
  const source = node.source ?? 'local-static';
  const base = MAP[source] ?? MAP['local-static']!;
  let label = base.label;
  // service/status only live on folder roots; file roots fall back to the
  // generic per-source label.
  const service = node.type === 'folder' ? node.service : undefined;
  const status = node.type === 'folder' ? node.status : undefined;
  if (source === 'cloud' || source === 'bus' || source === 'db') {
    label = (service ?? base.label).toUpperCase();
  }
  const showDot =
    status === 'streaming' || source === 'local-live' || source === 'stream';
  return (
    <span className={`lv-root-badge ${base.cls}`}>
      {showDot && <span className="lv-root-pulse" aria-hidden="true" />}
      {label}
    </span>
  );
};
