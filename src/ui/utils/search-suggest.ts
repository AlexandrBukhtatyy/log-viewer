import type { FieldDescriptor } from '../../core/filter/field-descriptor.ts';
import type { QueryMode } from '../../core/types/index.ts';
import type { LvSavedSearch } from '../contracts/lv-types.ts';

export type SuggestKind = 'recent' | 'saved' | 'value' | 'syntax';

export interface SearchSuggestion {
  readonly kind: SuggestKind;
  /** Section header this item belongs under. */
  readonly group: string;
  /** Primary display text. */
  readonly label: string;
  /** Secondary text (field key, count, saved-search name, …). */
  readonly hint?: string;
  /** The full query string to set when this item is accepted. */
  readonly insert: string;
}

export interface BuildSuggestionsInput {
  readonly query: string;
  readonly mode: QueryMode;
  readonly descriptors: ReadonlyArray<FieldDescriptor>;
  readonly saved: ReadonlyArray<LvSavedSearch>;
  readonly recent: ReadonlyArray<string>;
}

const PER_GROUP = 6;
const VALUE_GROUP = 8;

/** Split a query into the part before the last token and the last token
 *  itself. A trailing space means the last token is empty (head = whole). */
export const splitLastToken = (
  q: string,
): { readonly head: string; readonly token: string } => {
  const m = /\S*$/.exec(q);
  const token = m ? m[0] : '';
  return { head: q.slice(0, q.length - token.length), token };
};

const stripTokenPunct = (t: string): string =>
  t.replace(/^[-"']+/, '').replace(/[*"']+$/, '');

/**
 * Build the grouped autocomplete suggestions for the search box. Pure —
 * lives outside the components so it can be unit-tested in node.
 *
 *  - Recent / Saved  → replace the WHOLE query (`insert` is the stored query).
 *  - Field values    → replace the LAST token with the value.
 *  - FTS syntax      → contextual operator edits, only in `fts` mode.
 */
export const buildSearchSuggestions = ({
  query,
  mode,
  descriptors,
  saved,
  recent,
}: BuildSuggestionsInput): ReadonlyArray<SearchSuggestion> => {
  const out: SearchSuggestion[] = [];
  const trimmed = query.trim();
  const qLower = trimmed.toLowerCase();
  const { head, token } = splitLastToken(query);
  const tokenCore = stripTokenPunct(token).toLowerCase();

  // --- Recent ---
  for (const r of recent) {
    if (out.filter((s) => s.kind === 'recent').length >= PER_GROUP) break;
    if (r === trimmed) continue; // don't suggest exactly what's typed
    if (qLower !== '' && !r.toLowerCase().includes(qLower)) continue;
    out.push({ kind: 'recent', group: 'Recent', label: r, insert: r });
  }

  // --- Saved ---
  for (const s of saved) {
    if (out.filter((x) => x.kind === 'saved').length >= PER_GROUP) break;
    if (s.query === '') continue;
    const hay = `${s.name} ${s.query}`.toLowerCase();
    if (qLower !== '' && !hay.includes(qLower)) continue;
    out.push({
      kind: 'saved',
      group: 'Saved',
      label: s.query,
      hint: s.name,
      insert: s.query,
    });
  }

  // --- Field values ---
  // Flatten topValues across descriptors, rank startsWith over includes and
  // higher counts first, dedupe by value.
  type Cand = { value: string; count: number; field: string; rank: number };
  const seen = new Set<string>();
  const cands: Cand[] = [];
  for (const d of descriptors) {
    if (d.topValues === undefined) continue;
    for (const tv of d.topValues) {
      const v = tv.value;
      if (v === '' || v.length > 80) continue;
      const vl = v.toLowerCase();
      if (tokenCore !== '' && !vl.includes(tokenCore)) continue;
      if (seen.has(vl)) continue;
      seen.add(vl);
      const rank = tokenCore === '' ? 0 : vl.startsWith(tokenCore) ? 2 : 1;
      cands.push({ value: v, count: tv.count, field: d.label, rank });
    }
  }
  cands.sort((a, b) => b.rank - a.rank || b.count - a.count);
  for (const c of cands.slice(0, VALUE_GROUP)) {
    out.push({
      kind: 'value',
      group: 'Values',
      label: c.value,
      hint: c.field,
      insert: `${head}${c.value}`,
    });
  }

  // --- FTS syntax (only in fts mode) ---
  if (mode === 'fts') {
    const trimEnd = query.replace(/\s+$/, '');
    if (tokenCore !== '') {
      out.push({
        kind: 'syntax',
        group: 'Syntax',
        label: `"${stripTokenPunct(token)}"`,
        hint: 'exact phrase',
        insert: `${head}"${stripTokenPunct(token)}"`,
      });
      out.push({
        kind: 'syntax',
        group: 'Syntax',
        label: `${stripTokenPunct(token)}*`,
        hint: 'prefix',
        insert: `${head}${stripTokenPunct(token)}*`,
      });
      out.push({
        kind: 'syntax',
        group: 'Syntax',
        label: `-${stripTokenPunct(token)}`,
        hint: 'exclude',
        insert: `${head}-${stripTokenPunct(token)}`,
      });
    }
    if (trimEnd !== '') {
      out.push({
        kind: 'syntax',
        group: 'Syntax',
        label: `${trimEnd} OR …`,
        hint: 'either term',
        insert: `${trimEnd} OR `,
      });
    }
  }

  return out;
};
