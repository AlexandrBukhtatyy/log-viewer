import type { FieldDescriptor } from '../../core/filter/field-descriptor.ts';

/**
 * Compatibility verdict for a single dynamic field against the
 * user's active source set (Phase 3 of the multi-format roadmap):
 *   - `shared`  → field is present in every active source (or builtin).
 *   - `partial` → field is present in some, not all.
 *   - `unique`  → field appears in exactly one source.
 *
 * Built-ins always come back as `shared` — they're universal.
 *
 * `total` is the size of the active set (or the full set of sources
 * the descriptor knows about, when the caller didn't filter). Used by
 * the picker to render `n/total`.
 */
export type CompatKind = 'shared' | 'partial' | 'unique';

export interface FieldCompat {
  readonly kind: CompatKind;
  readonly presentIn: number;
  readonly total: number;
  /** Source ids the field is present in — feeds tooltips and chip warnings. */
  readonly presentSources: ReadonlyArray<string>;
  /** Source ids the field is missing from (drives `excludes N of M`). */
  readonly missingSources: ReadonlyArray<string>;
}

export const compatOf = (
  desc: FieldDescriptor,
  activeSources: ReadonlyArray<string>,
): FieldCompat => {
  // Empty `activeSources` means the caller didn't restrict — treat
  // the descriptor's own perSource as the universe. For builtins
  // (no perSource), we still report `shared` against whatever the
  // caller passed.
  const fromDescriptor = desc.perSource ?? [];
  const universe =
    activeSources.length > 0
      ? activeSources
      : fromDescriptor.map((p) => p.sourceId);
  const total = universe.length;
  if (desc.origin === 'builtin' || fromDescriptor.length === 0) {
    return {
      kind: 'shared',
      presentIn: total,
      total,
      presentSources: universe,
      missingSources: [],
    };
  }
  const presentSet = new Set(
    fromDescriptor.filter((p) => p.occurrences > 0).map((p) => p.sourceId),
  );
  const presentSources = universe.filter((sid) => presentSet.has(sid));
  const missingSources = universe.filter((sid) => !presentSet.has(sid));
  const presentIn = presentSources.length;
  const kind: CompatKind =
    presentIn === total ? 'shared' : presentIn <= 1 ? 'unique' : 'partial';
  return { kind, presentIn, total, presentSources, missingSources };
};

/**
 * Short label rendered inside the badge (`3/5`, `pino`, …). The badge
 * itself decides the tone; this just picks the text.
 */
export const compatBadgeText = (
  compat: FieldCompat,
  sourceNameById: ReadonlyMap<string, string>,
): string | null => {
  if (compat.kind === 'shared') return null;
  if (compat.kind === 'unique') {
    const sid = compat.presentSources[0];
    if (!sid) return '1 source';
    return sourceNameById.get(sid) ?? sid;
  }
  return `${compat.presentIn}/${compat.total}`;
};
