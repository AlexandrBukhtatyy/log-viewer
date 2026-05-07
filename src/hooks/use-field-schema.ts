import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { useViewStore } from '../app/providers/view-store-context.ts';
import type { FieldDescriptor } from '../core/filter/field-descriptor.ts';
import { BUILT_IN_FIELD_DESCRIPTORS } from '../core/filter/field-descriptor.ts';

const INITIAL: ReadonlyArray<FieldDescriptor> = BUILT_IN_FIELD_DESCRIPTORS;

export interface UseFieldSchema {
  readonly descriptors: ReadonlyArray<FieldDescriptor>;
}

/**
 * Discover available field descriptors for the active filter
 * (ADR-0017). Built-ins are returned immediately so pickers always
 * have something to render; dynamic descriptors are layered in once
 * the coordinator responds.
 *
 * Re-fetches on filter / version change. The same `version` tick
 * that drives `useGroupCounts` and `useHistogram` triggers a refresh
 * here too — when ingest produces a new key, the picker sees it.
 */
export const useFieldSchema = (): UseFieldSchema => {
  const store = useViewStore();
  const filter = useStore(store, (s) => s.filter);
  const version = useStore(store, (s) => s.version);

  const [descriptors, setDescriptors] = useState<ReadonlyArray<FieldDescriptor>>(INITIAL);
  const tokenRef = useRef(0);

  useEffect(() => {
    const token = ++tokenRef.current;
    store
      .getState()
      .getFieldSchema(filter)
      .then((next) => {
        if (token !== tokenRef.current) return;
        setDescriptors(next);
      })
      .catch((err: unknown) => {
        if (token !== tokenRef.current) return;
        console.error('[useFieldSchema] failed', err);
        setDescriptors(INITIAL);
      });
  }, [store, filter, version]);

  return { descriptors };
};
