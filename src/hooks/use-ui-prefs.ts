import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type LvTweakTheme = 'dark' | 'light';
export type LvTweakDensity = 'compact' | 'comfortable';

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
}

const DEFAULTS: LvTweaks = {
  theme: 'dark',
  density: 'compact',
  wrap: false,
  showDate: false,
  accent: '#7aa2f7',
  timelineOn: true,
  sidebarWidth: 260,
  sidebarCollapsed: false,
  columns: [],
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
      }),
    },
  ),
);
