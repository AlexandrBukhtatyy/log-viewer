import { useStore } from 'zustand';
import { useViewStore } from '../app/providers/view-store-context.ts';
import type { SourceRecord } from '../core/types/index.ts';

export interface UseSourceStatus {
  readonly sources: ReadonlyArray<SourceRecord>;
}

export const useSourceStatus = (): UseSourceStatus => {
  const store = useViewStore();
  const sources = useStore(store, (s) => s.sources);
  return { sources };
};
