import { useEffect, useMemo, useRef, useState } from 'react';
import type { GroupBucket } from '../core/rpc/coordinator.contract.ts';
import type { LogFilter, LogicalField } from '../core/types/index.ts';
import type { StructuredValue } from '../ui/utils/search-suggest.ts';

const MAX_FIELDS = 6;
const PER_FIELD = 8;

/** Cache-key signature: the structural parts of the filter that affect
 *  distinct values (sources / files / level / time / field filters), but
 *  NOT the free-text query — values don't depend on what the user is
 *  typing in the search box. */
const filterSignature = (f: LogFilter): string =>
  JSON.stringify([
    f.sources ?? null,
    f.filePaths ?? null,
    f.levels ?? null,
    f.timeRange ?? null,
    f.fieldFilters ?? null,
  ]);

export interface FieldValueSuggestionsInput {
  readonly activeLogicalFields: ReadonlyArray<LogicalField>;
  readonly filter: LogFilter;
  fetchGroupCounts: (
    f: LogFilter,
    field: string,
    limit?: number,
  ) => Promise<ReadonlyArray<GroupBucket>>;
}

/**
 * Lazily fetch distinct top values for the active logical fields so the
 * search autocomplete can offer `~field = value` structured filters. Logical
 * fields are user-curated and few, so we fetch one `getGroupCounts` per field
 * (capped) rather than wiring per-token requests; results are cached per
 * (field, filter-signature) and merged into the structured-value list the
 * suggestion builder filters by token.
 */
export const useFieldValueSuggestions = ({
  activeLogicalFields,
  filter,
  fetchGroupCounts,
}: FieldValueSuggestionsInput): ReadonlyArray<StructuredValue> => {
  const [cache, setCache] = useState<
    Readonly<Record<string, ReadonlyArray<StructuredValue>>>
  >({});
  const cacheRef = useRef(cache);
  useEffect(() => {
    cacheRef.current = cache;
  }, [cache]);

  const sig = useMemo(() => filterSignature(filter), [filter]);
  const fields = useMemo(
    () => activeLogicalFields.slice(0, MAX_FIELDS),
    [activeLogicalFields],
  );

  useEffect(() => {
    if (fields.length === 0) return;
    let cancelled = false;
    const handle = setTimeout(() => {
      void (async () => {
        for (const fld of fields) {
          const ck = `${sig}|~${fld.id}`;
          if (cacheRef.current[ck] !== undefined) continue;
          try {
            const buckets = await fetchGroupCounts(
              filter,
              `~${fld.id}`,
              PER_FIELD,
            );
            if (cancelled) return;
            const vals: StructuredValue[] = buckets
              .filter((b) => b.value !== null && b.value !== '')
              .map((b) => ({
                key: `~${fld.id}`,
                label: fld.label,
                value: String(b.value),
                count: b.count,
              }));
            setCache((c) => ({ ...c, [ck]: vals }));
          } catch {
            // Worker not ready / transient — leave uncached, retry next change.
          }
        }
      })();
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [fields, sig, filter, fetchGroupCounts]);

  return useMemo(() => {
    const out: StructuredValue[] = [];
    for (const fld of fields) {
      const hit = cache[`${sig}|~${fld.id}`];
      if (hit !== undefined) out.push(...hit);
    }
    return out;
  }, [fields, sig, cache]);
};
