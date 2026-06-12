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

/**
 * A named bundle of `columns` that the user can apply to any tab in
 * one click. Built-in presets are hardcoded and read-only; user
 * presets persist to `lv:ui-prefs`.
 */
export interface LvColumnPreset {
  readonly id: string;
  readonly name: string;
  readonly columns: ReadonlyArray<LvColumnPref>;
  readonly origin: 'builtin' | 'user';
}

export interface LvTweaks {
  theme: LvTweakTheme;
  density: LvTweakDensity;
  showDate: boolean;
  accent: string;
  timelineOn: boolean;
  /** Width of the middle column (sidebar / search / bookmarks / AI panel) in px. */
  sidebarWidth: number;
  /** When true, the middle column is hidden (VSCode-style collapse). Toggle via Cmd/Ctrl+B or by clicking the active rail icon. */
  sidebarCollapsed: boolean;
  /**
   * All data columns in the table — built-in (`@ts`, `@level`,
   * `@source.name`, `@file`), dynamic JSON keys, and logical
   * `~*` keys. Layout is a flat array; the chrome (LN gutter,
   * caret, message and actions) is always rendered. Empty by
   * default — a fresh table shows only the gutter and message.
   */
  columns: ReadonlyArray<LvColumnPref>;
  /**
   * What the gutter (leftmost) column shows for each row. Default is
   * the physical line number in the file (`line`); the user can
   * switch to the per-file entry ordinal or show both side by side.
   */
  gutterMode: LvGutterMode;
  /**
   * User-defined column presets. Each preset bundles a `columns`
   * list and can be applied to any tab in one click. Built-in
   * presets are not stored here — they live in code and are merged
   * at read time by the consumer.
   */
  presets: ReadonlyArray<LvColumnPreset>;
}

const DEFAULTS: LvTweaks = {
  theme: 'dark',
  density: 'compact',
  showDate: true,
  accent: '#7aa2f7',
  timelineOn: false,
  sidebarWidth: 260,
  sidebarCollapsed: false,
  columns: [],
  gutterMode: 'line',
  presets: [],
};

interface UiPrefsState extends LvTweaks {
  setTweak<K extends keyof LvTweaks>(key: K, value: LvTweaks[K]): void;
  reset(): void;
}

/**
 * Pure migrate function for `lv:ui-prefs`. Exported for unit tests;
 * the persist middleware also references it inline below. Side-effect
 * free and idempotent.
 */
export const migrateUiPrefs = (
  persisted: unknown,
  version: number,
): LvTweaks | unknown => {
  if (!persisted || typeof persisted !== 'object') return persisted;
  let p = persisted as Partial<LvTweaks> & Record<string, unknown>;
  if (version < 1) {
    p = { ...p, timelineOn: false };
  }
  if (version < 2) {
    const cols = Array.isArray(p.columns) ? (p.columns as LvColumnPref[]) : [];
    const seed: LvColumnPreset[] =
      cols.length > 0
        ? [
            {
              id: 'user:legacy',
              name: 'My columns',
              columns: cols,
              origin: 'user',
            },
          ]
        : [];
    const existing = Array.isArray(p.presets) ? (p.presets as LvColumnPreset[]) : [];
    p = {
      ...p,
      presets: existing.length > 0 ? existing : seed,
    };
  }
  if (version < 3) {
    // Phase 4 refactor: drop legacy boolean visibility flags (now
    // expressed as presence in `columns`) and the `wrap` toggle
    // (message column is now always single-line, no wrapping).
    const {
      showTimestamp: _showTimestamp,
      showLevel: _showLevel,
      showService: _showService,
      showFile: _showFile,
      wrap: _wrap,
      ...rest
    } = p;
    void _showTimestamp;
    void _showLevel;
    void _showService;
    void _showFile;
    void _wrap;
    p = rest;
  }
  return p;
};

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
      version: 3,
      migrate: (persisted, version) => migrateUiPrefs(persisted, version) as LvTweaks,
      partialize: (s): LvTweaks => ({
        theme: s.theme,
        density: s.density,
        showDate: s.showDate,
        accent: s.accent,
        timelineOn: s.timelineOn,
        sidebarWidth: s.sidebarWidth,
        sidebarCollapsed: s.sidebarCollapsed,
        columns: s.columns,
        gutterMode: s.gutterMode,
        presets: s.presets,
      }),
    },
  ),
);
