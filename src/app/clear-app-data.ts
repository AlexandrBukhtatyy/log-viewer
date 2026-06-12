/**
 * Centralised helpers for the File → Clear application data… flow.
 *
 * Worker-side data (SQLite index, OPFS spool, FS-handle registry, custom
 * parsers) is wiped through the existing `viewStore.clearAll()` action —
 * we don't duplicate that here. This module only owns the main-thread
 * pieces: zustand-persisted UI state in localStorage and the PWA cache
 * (service-worker registrations + Workbox precache).
 *
 * Each helper is independent, side-effect-only, and resolves to `void`.
 * Callers stitch them together based on the user's dialog selection.
 */

/**
 * All localStorage keys owned by the app. Kept here so the cleanup path
 * is the single source of truth — any new persisted store added in
 * `hooks/use-*.ts` should also be listed here, otherwise it will leak
 * across "Clear UI state" operations.
 */
const UI_STATE_LOCAL_STORAGE_KEYS: ReadonlyArray<string> = [
  'lv:bookmarks',
  'lv:saved-searches',
  'lv:recent-files',
  'lv:ui-prefs',
  'lv:workspace',
  'lv:jsParsersEnabled',
  'lv:logical-fields',
];

export const clearUiState = (): void => {
  if (typeof localStorage === 'undefined') return;
  for (const key of UI_STATE_LOCAL_STORAGE_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* private mode / quota — nothing we can do */
    }
  }
};

/**
 * Drop every Cache Storage bucket and unregister all service workers.
 * After this the next navigation re-fetches assets from the network and
 * re-registers the worker via the Vite-PWA virtual import.
 */
export const clearPwaCache = async (): Promise<void> => {
  if (typeof caches !== 'undefined') {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k).catch(() => false)));
    } catch (err) {
      console.warn('[clear-app-data] caches.keys/delete failed', err);
    }
  }
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
    } catch (err) {
      console.warn('[clear-app-data] serviceWorker.unregister failed', err);
    }
  }
};
