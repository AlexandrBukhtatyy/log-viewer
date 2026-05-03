import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { useViewStore } from '../app/providers/view-store-context.ts';
import type { GroupBucket } from '../core/rpc/coordinator.contract.ts';

const EMPTY: ReadonlyArray<GroupBucket> = [];

export interface UseGroupCounts {
  readonly buckets: ReadonlyArray<GroupBucket>;
  readonly isLoading: boolean;
}

/**
 * Server-side group-by aggregation for the active filter.
 *
 * Re-fetches when `field` or `limit` changes, when the filter changes, or when
 * `version` ticks (coordinator notices that source data changed). `field` of
 * `null` disables the hook (no request, empty buckets) — useful for the
 * "groupBy is off" case in the UI.
 */
export const useGroupCounts = (
  field: string | null,
  limit?: number,
): UseGroupCounts => {
  const store = useViewStore();
  const filter = useStore(store, (s) => s.filter);
  const version = useStore(store, (s) => s.version);
  const enabled = field !== null;

  const [buckets, setBuckets] = useState<ReadonlyArray<GroupBucket>>(EMPTY);
  const tokenRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const token = ++tokenRef.current;
    store
      .getState()
      .getGroupCounts(filter, field, limit)
      .then((next) => {
        if (token !== tokenRef.current) return;
        setBuckets(next);
      })
      .catch((err: unknown) => {
        if (token !== tokenRef.current) return;
        console.error('[useGroupCounts] failed', err);
        setBuckets(EMPTY);
      });
  }, [store, enabled, field, limit, filter, version]);

  if (!enabled) return { buckets: EMPTY, isLoading: false };
  return { buckets, isLoading: false };
};
