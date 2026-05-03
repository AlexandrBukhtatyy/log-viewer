import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { useViewStore } from '../app/providers/view-store-context.ts';
import type { HistogramResponse } from '../core/rpc/coordinator.contract.ts';

const EMPTY: HistogramResponse = { buckets: [], range: null };

export interface UseHistogram {
  readonly data: HistogramResponse;
  readonly isLoading: boolean;
}

/**
 * Server-side time-bucket histogram for the active filter.
 *
 * Re-fetches when `bucketCount` changes, when the filter changes, or when
 * `version` ticks. `bucketCount <= 0` short-circuits to an empty response.
 */
export const useHistogram = (bucketCount: number): UseHistogram => {
  const store = useViewStore();
  const filter = useStore(store, (s) => s.filter);
  const version = useStore(store, (s) => s.version);
  const enabled = bucketCount > 0;

  const [data, setData] = useState<HistogramResponse>(EMPTY);
  const tokenRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const token = ++tokenRef.current;
    store
      .getState()
      .getHistogram(filter, bucketCount)
      .then((next) => {
        if (token !== tokenRef.current) return;
        setData(next);
      })
      .catch((err: unknown) => {
        if (token !== tokenRef.current) return;
        console.error('[useHistogram] failed', err);
        setData(EMPTY);
      });
  }, [store, filter, enabled, bucketCount, version]);

  if (!enabled) return { data: EMPTY, isLoading: false };
  return { data, isLoading: false };
};
