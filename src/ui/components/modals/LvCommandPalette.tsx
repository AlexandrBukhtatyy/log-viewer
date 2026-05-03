import { useState } from 'react';

interface Command {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
}

const CMDS: Command[] = [
  { id: 'toggle-live', label: 'Toggle live tail', hint: '⌃⌥L' },
  { id: 'toggle-timeline', label: 'Toggle timeline', hint: '⌃⌥T' },
  { id: 'group-trace', label: 'Group by trace' },
  { id: 'group-request', label: 'Group by request' },
  { id: 'group-user', label: 'Group by user' },
  { id: 'group-service', label: 'Group by service' },
  { id: 'group-none', label: 'Clear grouping' },
  { id: 'clear-filters', label: 'Clear all filters' },
  { id: 'theme-toggle', label: 'Toggle light/dark', hint: '⌃⌥D' },
  { id: 'density-toggle', label: 'Toggle density' },
  { id: 'select-all', label: 'Select all files', hint: '⌃A' },
  { id: 'open-vscode', label: 'Open selected line in VS Code' },
  { id: 'open-cursor', label: 'Open selected line in Cursor' },
  { id: 'copy-path', label: 'Copy path:line of selected line' },
];

export interface LvCommandPaletteProps {
  onClose: () => void;
  onRun: (id: string) => void;
}

export const LvCommandPalette = ({ onClose, onRun }: LvCommandPaletteProps) => {
  const [q, setQ] = useState('');
  const filtered = CMDS.filter((c) => !q || c.label.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="lv-cmd-overlay" onClick={onClose}>
      <div className="lv-cmd" onClick={(e) => e.stopPropagation()}>
        <div className="lv-cmd-hd">
          <svg viewBox="0 0 14 14" width="12" height="12">
            <circle cx="6" cy="6" r="4" fill="none" stroke="currentColor" strokeWidth="1.2" />
            <path d="M9 9 L12 12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Type a command or search…"
          />
          <button type="button" className="lv-kbd" onClick={onClose}>
            Esc
          </button>
        </div>
        <div className="lv-cmd-list">
          {filtered.map((c) => (
            <button
              type="button"
              key={c.id}
              className="lv-cmd-item"
              onClick={() => {
                onRun(c.id);
                onClose();
              }}
            >
              <span>{c.label}</span>
              {c.hint && <span className="lv-kbd">{c.hint}</span>}
            </button>
          ))}
          {filtered.length === 0 && <div className="lv-cmd-empty">No matching commands.</div>}
        </div>
      </div>
    </div>
  );
};
