import type { LvLogKind } from '../../contracts/lv-types.ts';

const MAP: Record<string, { label: string; color: string }> = {
  app: { label: 'LOG', color: 'var(--lv-kind-app)' },
  json: { label: '{ }', color: 'var(--lv-kind-json)' },
  nginx: { label: 'NGX', color: 'var(--lv-kind-nginx)' },
  k8s: { label: 'K8S', color: 'var(--lv-kind-k8s)' },
  syslog: { label: 'SYS', color: 'var(--lv-kind-syslog)' },
  stacktrace: { label: 'ERR', color: 'var(--lv-kind-stack)' },
};

export interface LvFileIconProps {
  readonly kind: LvLogKind | string;
}

export const LvFileIcon = ({ kind }: LvFileIconProps) => {
  const m = MAP[kind] ?? { label: 'LOG', color: 'var(--lv-muted)' };
  return (
    <span className="lv-file-ico" style={{ color: m.color, borderColor: 'currentColor' }}>
      {m.label}
    </span>
  );
};
