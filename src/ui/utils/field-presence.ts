import type { FieldDescriptor } from '../../core/filter/field-descriptor.ts';

/**
 * Strict "is this dynamic field present in at least one of the active
 * sources" check. Mirrors what users expect from the column picker and
 * the group-by picker: on a single-file tab they want **only** the
 * fields that actually live in that file; on the multi-select tab
 * they want the union over selected sources.
 *
 * Differs from `compatOf`: a dynamic descriptor with empty `perSource`
 * (unknown origin) is hidden here, while `compatOf` treats it as
 * `shared`. Built-ins are not handled — caller filters by origin.
 *
 * When `activeIds` is empty (no sources picked) the caller should
 * fall back to "show everything" — this function returns `false` for
 * every dynamic descriptor without an explicit override.
 */
export const isPresentInActiveSources = (
  d: FieldDescriptor,
  activeIds: ReadonlyArray<string>,
): boolean => {
  if (!d.perSource || d.perSource.length === 0) return false;
  const activeSet = new Set(activeIds);
  return d.perSource.some(
    (p) => p.occurrences > 0 && activeSet.has(p.sourceId),
  );
};
