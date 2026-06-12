import type { LogicalField } from '../types/logical-field.ts';

/**
 * Suggest logical-field templates the user has not yet activated based
 * on raw field keys discovered in the open sources (ADR-0030 Phase 3).
 *
 * The matcher is conservative: a template is suggested when at least
 * one of its `field`/`regex-on-json` extractor paths exactly equals
 * one of the discovered keys. This avoids fuzzy false positives like
 * suggesting `~user_id` because a source happens to have a `user` key.
 *
 * Returns one entry per matched template with the list of discovered
 * keys responsible for the match, so the UI can explain "suggested
 * because we see `traceId` and `tid` in your sources".
 */
export interface LogicalFieldSuggestion {
  readonly field: LogicalField;
  readonly matchedKeys: ReadonlyArray<string>;
}

export const findSuggestedLogicalFields = (
  templates: ReadonlyArray<LogicalField>,
  discoveredKeys: ReadonlyArray<string>,
  activeIds: ReadonlyArray<string>,
): ReadonlyArray<LogicalFieldSuggestion> => {
  const active = new Set(activeIds);
  const discovered = new Set(discoveredKeys);
  const out: LogicalFieldSuggestion[] = [];
  for (const t of templates) {
    if (active.has(t.id)) continue;
    const paths = new Set<string>();
    for (const ex of t.extractors) {
      if (ex.type === 'field' || ex.type === 'regex-on-json') {
        // First path segment is the "top-level key" the field_meta
        // discovery layer indexes — `service.name` matches a source
        // that emitted `service` (the resolver descends into it).
        const top = ex.path.split('.')[0]!;
        if (top.length > 0) paths.add(top);
      }
    }
    const matched: string[] = [];
    for (const p of paths) if (discovered.has(p)) matched.push(p);
    if (matched.length > 0) out.push({ field: t, matchedKeys: matched });
  }
  return out;
};
