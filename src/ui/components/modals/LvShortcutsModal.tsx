import { useEffect } from 'react';

interface ShortcutItem {
  readonly keys: ReadonlyArray<string>;
  readonly label: string;
  readonly mono?: boolean;
}

interface ShortcutSection {
  readonly title: string;
  readonly items: ReadonlyArray<ShortcutItem>;
}

const SECTIONS: ShortcutSection[] = [
  {
    title: 'General',
    items: [
      { keys: ['⌘', 'K'], label: 'Open command palette' },
      { keys: ['⌘', 'O'], label: 'Open file…' },
      { keys: ['⇧', '⌘', 'O'], label: 'Open folder…' },
      { keys: ['⌘', ','], label: 'Open settings' },
      { keys: ['⌘', 'K', '⌘', 'S'], label: 'Keyboard shortcuts' },
      { keys: ['Esc'], label: 'Close dialog / palette' },
    ],
  },
  {
    title: 'Sidebar',
    items: [
      { keys: ['⌘', 'B'], label: 'Toggle sidebar' },
      { keys: ['⇧', '⌘', 'E'], label: 'Show Files' },
      { keys: ['⇧', '⌘', 'F'], label: 'Show Search' },
      { keys: ['⇧', '⌘', 'B'], label: 'Show Bookmarks' },
      { keys: ['⇧', '⌘', 'A'], label: 'Show Alerts' },
      { keys: ['⇧', '⌘', 'L'], label: 'Show AI assistant' },
    ],
  },
  {
    title: 'View',
    items: [
      { keys: ['⌃', '⌥', 'L'], label: 'Toggle live tail' },
      { keys: ['⌃', '⌥', 'T'], label: 'Toggle timeline' },
      { keys: ['⌃', '⌥', 'D'], label: 'Toggle dark / light theme' },
    ],
  },
  {
    title: 'Files & Tabs',
    items: [
      { keys: ['⌘', 'S'], label: 'Save filtered view' },
      { keys: ['⌘', 'W'], label: 'Close tab' },
      { keys: ['⇧', '⌘', 'W'], label: 'Close all tabs' },
      { keys: ['⇧', '⌘', 'N'], label: 'New window' },
    ],
  },
  {
    title: 'Search syntax',
    items: [
      { keys: ['level:error'], label: 'Filter by log level', mono: true },
      { keys: ['status:5'], label: 'Field starts-with', mono: true },
      { keys: ['\\bdeadlock\\b'], label: 'Regex (when regex toggle on)', mono: true },
    ],
  },
];

export interface LvShortcutsModalProps {
  readonly open: boolean;
  onClose: () => void;
}

export const LvShortcutsModal = ({ open, onClose }: LvShortcutsModalProps) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="lv-modal-scrim" onClick={onClose} />
      <div
        className="lv-modal lv-shortcuts-modal"
        role="dialog"
        aria-label="Keyboard Shortcuts"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="lv-modal-hd">
          <span>Keyboard Shortcuts</span>
          <button type="button" className="lv-modal-x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="lv-modal-body">
          {SECTIONS.map((sec) => (
            <div key={sec.title} className="lv-shortcuts-sec">
              <div className="lv-shortcuts-sec-hd">{sec.title}</div>
              <div className="lv-shortcuts-list">
                {sec.items.map((it, i) => (
                  <div key={i} className="lv-shortcuts-row">
                    <span className="lv-shortcuts-label">{it.label}</span>
                    <span className="lv-shortcuts-keys">
                      {it.keys.map((k, ki) => (
                        <span key={ki} className={`lv-kbd${it.mono ? ' lv-kbd-mono' : ''}`}>
                          {k}
                        </span>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="lv-modal-ft">
          <span className="lv-settings-muted">
            Press <span className="lv-kbd">Esc</span> to close.
          </span>
        </div>
      </div>
    </>
  );
};
