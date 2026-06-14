import { useEffect } from 'react';
import { LvEditorIcon } from './LvEditorIcon.tsx';

export interface LvOpenMenuProps {
  readonly path: string;
  readonly line: number;
  readonly anchor: { x: number; y: number };
  onOpenInApp: () => void;
  onClose: () => void;
}

interface MenuItem {
  readonly id?: string;
  readonly sep?: boolean;
  readonly label?: string;
  readonly hint?: string;
  readonly action?: () => void;
  readonly href?: string;
  readonly icon?: string;
}

export const LvOpenMenu = ({
  path,
  line,
  anchor,
  onOpenInApp,
  onClose,
}: LvOpenMenuProps) => {
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest?.('.lv-open-menu')) onClose();
    };
    const t = setTimeout(
      () => document.addEventListener('mousedown', onDoc),
      0,
    );
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDoc);
    };
  }, [onClose]);

  const href = (scheme: string): string => {
    switch (scheme) {
      case 'vscode':
        return `vscode://file${path}:${line}`;
      case 'cursor':
        return `cursor://file${path}:${line}`;
      case 'jetbrains':
        return `jetbrains://idea/navigate/reference?project=logs&path=${encodeURIComponent(path)}:${line}`;
      case 'sublime':
        return `subl://open?url=file://${encodeURIComponent(path)}&line=${line}`;
      case 'zed':
        return `zed://file${path}:${line}`;
      default:
        return '#';
    }
  };

  const items: MenuItem[] = [
    {
      id: 'inapp',
      label: 'Open in viewer',
      hint: 'At line',
      action: () => {
        onOpenInApp();
        onClose();
      },
      icon: 'eye',
    },
    { sep: true },
    {
      id: 'vscode',
      label: 'Open in VS Code',
      hint: `vscode://…:${line}`,
      href: href('vscode'),
      icon: 'vscode',
    },
    {
      id: 'cursor',
      label: 'Open in Cursor',
      hint: `cursor://…:${line}`,
      href: href('cursor'),
      icon: 'cursor',
    },
    {
      id: 'jetbrains',
      label: 'Open in JetBrains IDE',
      hint: 'IDEA/WebStorm/PyCharm',
      href: href('jetbrains'),
      icon: 'jb',
    },
    {
      id: 'sublime',
      label: 'Open in Sublime Text',
      hint: `subl://…&line=${line}`,
      href: href('sublime'),
      icon: 'sublime',
    },
    {
      id: 'zed',
      label: 'Open in Zed',
      hint: `zed://…:${line}`,
      href: href('zed'),
      icon: 'zed',
    },
    { sep: true },
    {
      id: 'copy-path',
      label: 'Copy path:line',
      hint: `${path}:${line}`,
      action: () => {
        navigator.clipboard?.writeText(`${path}:${line}`);
        onClose();
      },
      icon: 'copy',
    },
  ];

  return (
    <div className="lv-open-menu" style={{ top: anchor.y, left: anchor.x }}>
      <div className="lv-open-hd">
        <span className="lv-open-path">{path}</span>
        <span className="lv-open-line">:{line}</span>
      </div>
      {items.map((it, i) =>
        it.sep ? (
          <div key={i} className="lv-open-sep" />
        ) : it.href ? (
          <a
            key={it.id ?? i}
            className="lv-open-item"
            href={it.href}
            onClick={onClose}
          >
            {it.icon && <LvEditorIcon icon={it.icon} />}
            <span className="lv-open-lbl">{it.label}</span>
            <span className="lv-open-hint">{it.hint}</span>
          </a>
        ) : (
          <button
            key={it.id ?? i}
            type="button"
            className="lv-open-item"
            onClick={it.action}
          >
            {it.icon && <LvEditorIcon icon={it.icon} />}
            <span className="lv-open-lbl">{it.label}</span>
            <span className="lv-open-hint">{it.hint}</span>
          </button>
        ),
      )}
    </div>
  );
};
