import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type LvTweakTheme = 'dark' | 'light';
export type LvTweakDensity = 'compact' | 'comfortable';
/**
 * What the leftmost (gutter) column of the table shows.
 *   - `line`  — physical line number in the source file (default)
 *   - `entry` — per-file 1-based ordinal of the log record
 *   - `both`  — `<line> · <entry>`
 */
export type LvGutterMode = 'line' | 'entry' | 'both';

/**
 * One user-added column persisted in UI prefs (ADR-0017 Phase 5).
 * Mirrors `LvColumn` (in lv-types.ts) but lives next to the hook so
 * `hooks/` can stay free of `ui/` imports per ADR-0002 layer rules.
 */
export interface LvColumnPref {
  readonly key: string;
  readonly label?: string;
  readonly widthPx: number;
}

export interface LvTweaks {
  theme: LvTweakTheme;
  density: LvTweakDensity;
  wrap: boolean;
  showDate: boolean;
  accent: string;
  timelineOn: boolean;
  /** Width of the middle column (sidebar / search / bookmarks / AI panel) in px. */
  sidebarWidth: number;
  /** When true, the middle column is hidden (VSCode-style collapse). Toggle via Cmd/Ctrl+B or by clicking the active rail icon. */
  sidebarCollapsed: boolean;
  /**
   * User-added table columns rendered between the fixed FILE column
   * and MESSAGE. The fixed columns (LN/TIMESTAMP/LEVEL/SERVICE/FILE/
   * MESSAGE/ACTIONS) are not in this list — they are always shown.
   */
  columns: ReadonlyArray<LvColumnPref>;
  /**
   * What the gutter (leftmost) column shows for each row. Default is
   * the physical line number in the file (`line`); the user can
   * switch to the per-file entry ordinal or show both side by side.
   */
  gutterMode: LvGutterMode;
}

const DEFAULTS: LvTweaks = {
  theme: 'dark',
  density: 'compact',
  wrap: false,
  showDate: true,
  accent: '#7aa2f7',
  timelineOn: false,
  sidebarWidth: 260,
  sidebarCollapsed: false,
  columns: [],
  gutterMode: 'line',
};

interface UiPrefsState extends LvTweaks {
  setTweak<K extends keyof LvTweaks>(key: K, value: LvTweaks[K]): void;
  reset(): void;
}

/**
 * UI preferences (theme, density, accent, wrap, showDate, timelineOn) with
 * `localStorage`-persistence. UI-only — does not touch ViewStore.
 */
export const useUiPrefs = create<UiPrefsState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      setTweak: (key, value) => set({ [key]: value } as Partial<UiPrefsState>),
      reset: () => set(DEFAULTS),
    }),
    {
      name: 'lv:ui-prefs',
      version: 1,
      migrate: (persisted, version) => {
        if (version < 1 && persisted && typeof persisted === 'object') {
          return { ...(persisted as Partial<LvTweaks>), timelineOn: false };
        }
        return persisted as LvTweaks;
      },
      partialize: (s): LvTweaks => ({
        theme: s.theme,
        density: s.density,
        wrap: s.wrap,
        showDate: s.showDate,
        accent: s.accent,
        timelineOn: s.timelineOn,
        sidebarWidth: s.sidebarWidth,
        sidebarCollapsed: s.sidebarCollapsed,
        columns: s.columns,
        gutterMode: s.gutterMode,
      }),
    },
  ),
);
