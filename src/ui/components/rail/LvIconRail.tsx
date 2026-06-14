import type { ReactNode } from 'react';
import type { LvRail } from '../../contracts/lv-types.ts';

interface RailItem {
  readonly id: LvRail;
  readonly label: string;
  readonly icon: ReactNode;
}

const ITEMS: RailItem[] = [
  {
    id: 'files',
    label: 'Files',
    icon: (
      <svg viewBox="0 0 16 16" width="16" height="16">
        <path
          d="M2 3.2 A1 1 0 0 1 3 2.2 H6.2 L7.8 3.8 H13 A1 1 0 0 1 14 4.8 V12 A1 1 0 0 1 13 13 H3 A1 1 0 0 1 2 12 Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    id: 'search',
    label: 'Search',
    icon: (
      <svg viewBox="0 0 16 16" width="16" height="16">
        <circle
          cx="7"
          cy="7"
          r="4.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
        />
        <path
          d="M10.5 10.5 L14 14"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    id: 'bookmarks',
    label: 'Bookmarks',
    icon: (
      <svg viewBox="0 0 16 16" width="16" height="16">
        <path
          d="M4 2.5 H12 V13.5 L8 10.8 L4 13.5 Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    id: 'alerts',
    label: 'Alerts',
    icon: (
      <svg viewBox="0 0 16 16" width="16" height="16">
        <path
          d="M3.5 11 L12.5 11 A1 1 0 0 0 13.3 9.5 L12.3 8.1 V6 A4.3 4.3 0 0 0 3.7 6 V8.1 L2.7 9.5 A1 1 0 0 0 3.5 11 Z M6.5 12.5 A1.5 1.5 0 0 0 9.5 12.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    id: 'ai',
    label: 'AI assistant',
    icon: (
      <svg viewBox="0 0 16 16" width="16" height="16">
        <path
          d="M8 1.6 L9.25 6.05 L13.7 7.3 L9.25 8.55 L8 13 L6.75 8.55 L2.3 7.3 L6.75 6.05 Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinejoin="round"
        />
        <path
          d="M12.8 11.8 L13.3 13.4 L14.9 13.9 L13.3 14.4 L12.8 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity=".75"
        />
      </svg>
    ),
  },
  {
    id: 'fields',
    label: 'Logical fields',
    icon: (
      <svg viewBox="0 0 16 16" width="16" height="16">
        {/* Tilde-shaped wave atop a label tag — visual cue for
            "~-namespace fields". */}
        <path
          d="M2.5 5.5 C4 3.8 5.5 7 7 6 C8.5 5 10.5 7.6 12 6 C13 5 13.5 5 13.5 5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <path
          d="M2.5 9 H10.5 L13 11.5 L10.5 14 H2.5 Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    id: 'parsers',
    label: 'Parsers',
    icon: (
      <svg viewBox="0 0 16 16" width="16" height="16">
        {/* Outlined `{}` braces — convention for "code/regex/parser". */}
        <path
          d="M6 3 L4.5 3 A1.5 1.5 0 0 0 3 4.5 V7 L2 8 L3 9 V11.5 A1.5 1.5 0 0 0 4.5 13 H6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <path
          d="M10 3 L11.5 3 A1.5 1.5 0 0 1 13 4.5 V7 L14 8 L13 9 V11.5 A1.5 1.5 0 0 1 11.5 13 H10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
];

const SETTINGS_ICON = (
  <svg viewBox="0 0 16 16" width="16" height="16">
    <path
      d="M9.3 1.8 L9.55 3.35 A4.7 4.7 0 0 1 10.9 3.92 L12.16 2.99 L13.5 4.33 L12.58 5.6 A4.7 4.7 0 0 1 13.15 6.95 L14.7 7.2 V9.1 L13.15 9.35 A4.7 4.7 0 0 1 12.58 10.7 L13.5 11.97 L12.16 13.31 L10.9 12.38 A4.7 4.7 0 0 1 9.55 12.95 L9.3 14.5 H7.4 L7.15 12.95 A4.7 4.7 0 0 1 5.8 12.38 L4.54 13.31 L3.2 11.97 L4.12 10.7 A4.7 4.7 0 0 1 3.55 9.35 L2 9.1 V7.2 L3.55 6.95 A4.7 4.7 0 0 1 4.12 5.6 L3.2 4.33 L4.54 2.99 L5.8 3.92 A4.7 4.7 0 0 1 7.15 3.35 L7.4 1.8 Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinejoin="round"
    />
    <circle
      cx="8.35"
      cy="8.15"
      r="1.9"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
    />
  </svg>
);

export interface LvIconRailProps {
  readonly active: LvRail;
  /**
   * When true the sidebar is collapsed. Active icon is rendered without
   * the highlight bar (matches VSCode: clicking the active icon hides the
   * panel; the next click on any rail icon brings it back).
   */
  readonly collapsed?: boolean;
  onActivate: (id: LvRail) => void;
  onOpenSettings?: () => void;
  readonly settingsOpen?: boolean;
}

export const LvIconRail = ({
  active,
  collapsed,
  onActivate,
  onOpenSettings,
  settingsOpen,
}: LvIconRailProps) => (
  <nav className="lv-rail">
    {ITEMS.map((it) => {
      const showActive = active === it.id && !collapsed;
      return (
        <button
          type="button"
          key={it.id}
          className={`lv-rail-btn${showActive ? ' is-active' : ''}`}
          onClick={() => onActivate(it.id)}
          title={it.label}
        >
          {it.icon}
          {showActive && <span className="lv-rail-active-bar" />}
        </button>
      );
    })}
    <div style={{ flex: 1 }} />
    <button
      type="button"
      className={`lv-rail-btn${settingsOpen ? ' is-active' : ''}`}
      title="Settings"
      onClick={() => onOpenSettings?.()}
    >
      {SETTINGS_ICON}
      {settingsOpen && <span className="lv-rail-active-bar" />}
    </button>
  </nav>
);
