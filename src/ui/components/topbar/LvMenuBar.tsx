import { useEffect, useRef, useState } from 'react';
import { LvMenuButton } from './LvMenuButton.tsx';
import type { LvMenuItem } from './LvMenu.tsx';

export interface LvRecentFile {
  readonly id: string;
  readonly name: string;
  readonly path?: string;
}

export interface LvMenuBarProps {
  onOpenFile?: () => void;
  onCommand?: (id: string) => void;
  readonly recentFiles?: ReadonlyArray<LvRecentFile>;
  onOpenRecent?: (file: LvRecentFile) => void;
}

export const LvMenuBar = ({
  onOpenFile,
  onCommand,
  recentFiles,
  onOpenRecent,
}: LvMenuBarProps) => {
  const [openId, setOpenId] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openId) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpenId(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenId(null);
    };
    const t = setTimeout(() => document.addEventListener('mousedown', onDoc), 0);
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [openId]);

  const runAndClose = (fn?: () => void) => {
    setOpenId(null);
    fn?.();
  };

  const recents = recentFiles ?? [];
  const fileMenu: LvMenuItem[] = [
    { id: 'new-window', label: 'New Window', hint: '⇧⌘N', onRun: () => onCommand?.('new-window') },
    { kind: 'sep' },
    { id: 'open-file', label: 'Open File…', hint: '⌘O', onRun: () => onOpenFile?.() },
    { id: 'open-folder', label: 'Open Folder…', hint: '⇧⌘O', onRun: () => onCommand?.('open-folder') },
    {
      id: 'open-recent',
      label: 'Open Recent',
      submenu: recents.length
        ? [
            ...recents.map(
              (r): LvMenuItem => ({
                id: `recent:${r.id}`,
                label: r.name,
                hint: r.path,
                onRun: () => onOpenRecent?.(r),
              }),
            ),
            { kind: 'sep' },
            { id: 'recent-clear', label: 'Clear Recently Opened', onRun: () => onCommand?.('clear-recent') },
          ]
        : [{ id: 'no-recent', label: 'No recent files', disabled: true }],
    },
    { kind: 'sep' },
    { id: 'save-view', label: 'Save Filtered View…', hint: '⌘S', onRun: () => onCommand?.('save-view') },
    {
      id: 'export',
      label: 'Export',
      submenu: [
        { id: 'export-json', label: 'As JSON', onRun: () => onCommand?.('export-json') },
        { id: 'export-csv', label: 'As CSV', onRun: () => onCommand?.('export-csv') },
        { id: 'export-ndjson', label: 'As NDJSON', onRun: () => onCommand?.('export-ndjson') },
      ],
    },
    { kind: 'sep' },
    { id: 'close-tab', label: 'Close Tab', hint: '⌘W', onRun: () => onCommand?.('close-tab') },
    { id: 'close-all', label: 'Close All Tabs', hint: '⇧⌘W', onRun: () => onCommand?.('close-all-tabs') },
    { kind: 'sep' },
    {
      id: 'prefs',
      label: 'Preferences',
      submenu: [
        { id: 'prefs-settings', label: 'Settings', hint: '⌘,', onRun: () => onCommand?.('open-settings') },
        { id: 'prefs-keys', label: 'Keyboard Shortcuts', hint: '⌘K ⌘S', onRun: () => onCommand?.('open-keys') },
      ],
    },
    { id: 'clear-data', label: 'Clear Application Data…', onRun: () => onCommand?.('clear-data') },
    { kind: 'sep' },
    { id: 'exit', label: 'Exit', hint: '⌘Q', onRun: () => onCommand?.('exit') },
  ];

  const viewMenu: LvMenuItem[] = [
    { id: 'toggle-timeline', label: 'Toggle Timeline', hint: '⌃⌥T', onRun: () => onCommand?.('toggle-timeline') },
    { id: 'toggle-live', label: 'Toggle Live Tail', hint: '⌃⌥L', onRun: () => onCommand?.('toggle-live') },
    { kind: 'sep' },
    { id: 'group-trace', label: 'Group by Trace', onRun: () => onCommand?.('group-trace') },
    { id: 'group-request', label: 'Group by Request', onRun: () => onCommand?.('group-request') },
    { id: 'group-service', label: 'Group by Service', onRun: () => onCommand?.('group-service') },
    { id: 'group-none', label: 'Clear Grouping', onRun: () => onCommand?.('group-none') },
    { kind: 'sep' },
    { id: 'cmd-palette', label: 'Command Palette…', hint: '⌘K', onRun: () => onCommand?.('open-cmd') },
  ];

  const helpMenu: LvMenuItem[] = [
    { id: 'docs', label: 'Documentation', onRun: () => onCommand?.('help-docs') },
    { id: 'shortcuts', label: 'Keyboard Shortcuts', hint: '⌘K ⌘S', onRun: () => onCommand?.('open-keys') },
    { kind: 'sep' },
    { id: 'changelog', label: 'Release Notes', onRun: () => onCommand?.('help-changelog') },
    { id: 'report', label: 'Report Issue…', onRun: () => onCommand?.('help-report') },
    { kind: 'sep' },
    { id: 'about', label: 'About Log Viewer', onRun: () => onCommand?.('help-about') },
  ];

  const menus = [
    { id: 'file', label: 'File', items: fileMenu },
    { id: 'view', label: 'View', items: viewMenu },
    { id: 'help', label: 'Help', items: helpMenu },
  ];

  return (
    <div className="lv-menubar" ref={ref}>
      {menus.map((m) => (
        <LvMenuButton
          key={m.id}
          label={m.label}
          open={openId === m.id}
          onHover={() => {
            if (openId) setOpenId(m.id);
          }}
          onToggle={() => setOpenId((v) => (v === m.id ? null : m.id))}
          items={m.items}
          onRun={runAndClose}
        />
      ))}
    </div>
  );
};
