import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type LvTweakTheme = 'dark' | 'light';
export type LvTweakDensity = 'compact' | 'comfortable';

export interface LvTweaks {
  theme: LvTweakTheme;
  density: LvTweakDensity;
  wrap: boolean;
  showDate: boolean;
  accent: string;
  timelineOn: boolean;
}

const DEFAULTS: LvTweaks = {
  theme: 'dark',
  density: 'compact',
  wrap: false,
  showDate: false,
  accent: '#7aa2f7',
  timelineOn: true,
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
      }),
    },
  ),
);
