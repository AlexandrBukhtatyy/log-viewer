import { useEffect } from 'react';
import type { LvLogEntry } from '../../contracts/lv-types.ts';
import { LvEditorIcon } from './LvEditorIcon.tsx';

export interface LvOpenMenuProps {
  readonly entry: LvLogEntry;
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

export const LvOpenMenu = ({ entry, anchor, onOpenInApp, onClose }: LvOpenMenuProps) => {
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest?.('.lv-open-menu')) onClose();
    };
    const t = setTimeout(() => document.addEventListener('mousedown', onDoc), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDoc);
    };
  }, [onClose]);

  const href = (scheme: string): string => {
    switch (scheme) {
      case 'vscode':
        return `vscode://file${entry.path}:${entry.line}`;
      case 'cursor':
        return `cursor://file${entry.path}:${entry.line}`;
      case 'jetbrains':
        return `jetbrains://idea/navigate/reference?project=logs&path=${encodeURIComponent(entry.path)}:${entry.line}`;
      case 'sublime':
        return `subl://open?url=file://${encodeURIComponent(entry.path)}&line=${entry.line}`;
      case 'zed':
        return `zed://file${entry.path}:${entry.line}`;
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
    { id: 'vscode', label: 'Open in VS Code', hint: `vscode://…:${entry.line}`, href: href('vscode'), icon: 'vscode' },
    { id: 'cursor', label: 'Open in Cursor', hint: `cursor://…:${entry.line}`, href: href('cursor'), icon: 'cursor' },
    { id: 'jetbrains', label: 'Open in JetBrains IDE', hint: 'IDEA/WebStorm/PyCharm', href: href('jetbrains'), icon: 'jb' },
    { id: 'sublime', label: 'Open in Sublime Text', hint: `subl://…&line=${entry.line}`, href: href('sublime'), icon: 'sublime' },
    { id: 'zed', label: 'Open in Zed', hint: `zed://…:${entry.line}`, href: href('zed'), icon: 'zed' },
    { sep: true },
    {
      id: 'copy-path',
      label: 'Copy path:line',
      hint: `${entry.path}:${entry.line}`,
      action: () => {
        navigator.clipboard?.writeText(`${entry.path}:${entry.line}`);
        onClose();
      },
      icon: 'copy',
    },
  ];

  return (
    <div className="lv-open-menu" style={{ top: anchor.y, left: anchor.x }}>
      <div className="lv-open-hd">
        <span className="lv-open-path">{entry.path}</span>
        <span className="lv-open-line">:{entry.line}</span>
      </div>
      {items.map((it, i) =>
        it.sep ? (
          <div key={i} className="lv-open-sep" />
        ) : it.href ? (
          <a key={it.id ?? i} className="lv-open-item" href={it.href} onClick={onClose}>
            {it.icon && <LvEditorIcon icon={it.icon} />}
            <span className="lv-open-lbl">{it.label}</span>
            <span className="lv-open-hint">{it.hint}</span>
          </a>
        ) : (
          <button key={it.id ?? i} type="button" className="lv-open-item" onClick={it.action}>
            {it.icon && <LvEditorIcon icon={it.icon} />}
            <span className="lv-open-lbl">{it.label}</span>
            <span className="lv-open-hint">{it.hint}</span>
          </button>
        ),
      )}
    </div>
  );
};
