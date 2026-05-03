import type { LvFolderNode } from '../../contracts/lv-types.ts';

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
  readonly node: LvFolderNode;
}

export const LvRootBadge = ({ node }: LvRootBadgeProps) => {
  const source = node.source ?? 'local-static';
  const base = MAP[source] ?? MAP['local-static']!;
  let label = base.label;
  if (source === 'cloud' || source === 'bus' || source === 'db') {
    label = (node.service ?? base.label).toUpperCase();
  }
  const showDot =
    node.status === 'streaming' || source === 'local-live' || source === 'stream';
  return (
    <span className={`lv-root-badge ${base.cls}`}>
      {showDot && <span className="lv-root-pulse" aria-hidden="true" />}
      {label}
    </span>
  );
};
