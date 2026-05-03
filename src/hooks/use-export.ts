import { useCallback, useState } from 'react';
import { useViewStore } from '../app/providers/view-store-context.ts';
import type { ExportFormat } from '../core/rpc/coordinator.contract.ts';

const triggerDownload = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke after the click handler returns; some browsers need a tick.
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

const defaultFilename = (format: ExportFormat): string => {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const ext = format === 'csv' ? 'csv' : 'jsonl';
  return `log-viewer-${ts}.${ext}`;
};

export interface UseExport {
  /** True while a download is being prepared. */
  readonly isExporting: boolean;
  /**
   * Build a Blob of the current filter's matching entries and offer it to the
   * user as a download. Re-entrant calls are coalesced — the next click while
   * `isExporting` is true is silently ignored.
   */
  exportFiltered: (format: ExportFormat, filename?: string) => Promise<void>;
}

/**
 * Trigger a download of the active filter's matches as JSONL or CSV via
 * `coordinator.exportFiltered`. The Blob is materialized worker-side and
 * transferred to main; for very large datasets this loads the whole result
 * into memory — Phase 5+ would replace this with a streaming
 * `showSaveFilePicker` writer (see ADR-0014).
 */
export const useExport = (): UseExport => {
  const store = useViewStore();
  const [isExporting, setIsExporting] = useState(false);

  const exportFiltered = useCallback(
    async (format: ExportFormat, filename?: string) => {
      if (isExporting) return;
      setIsExporting(true);
      try {
        const blob = await store.getState().exportFiltered(format);
        triggerDownload(blob, filename ?? defaultFilename(format));
      } catch (err) {
        console.error('[useExport] failed', err);
      } finally {
        setIsExporting(false);
      }
    },
    [isExporting, store],
  );

  return { isExporting, exportFiltered };
};
