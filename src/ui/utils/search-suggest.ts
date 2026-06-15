import type { FieldDescriptor } from '../../core/filter/field-descriptor.ts';
import type { QueryMode } from '../../core/types/index.ts';
import type { LvSavedSearch } from '../contracts/lv-types.ts';

export type SuggestKind = 'recent' | 'saved' | 'value' | 'field' | 'syntax';

export interface SearchSuggestion {
  readonly kind: SuggestKind;
  /** Section header this item belongs under. */
  readonly group: string;
  /** Primary display text. */
  readonly label: string;
  /** Secondary text (field key, count, saved-search name, …). */
  readonly hint?: string;
  /**
   * Text suggestions (recent/saved/value/syntax): the full query string to
   * set when accepted. Absent for structured `field` suggestions.
   */
  readonly insert?: string;
  /**
   * Structured `field` suggestion — accepting adds a `key = value` field
   * filter instead of mutating the query text.
   */
  readonly filter?: { readonly key: string; readonly value: string };
}

/** A `field = value` candidate for the structured "Fields" group. Built by
 *  the container from system fields (@level / @source.*) and lazily-fetched
 *  logical-field values. */
export interface StructuredValue {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly count: number;
}

export interface BuildSuggestionsInput {
  readonly query: string;
  readonly mode: QueryMode;
  readonly descriptors: ReadonlyArray<FieldDescriptor>;
  readonly saved: ReadonlyArray<LvSavedSearch>;
  readonly recent: ReadonlyArray<string>;
  /** System/logical `field = value` candidates (structured filters). */
  readonly structuredValues?: ReadonlyArray<StructuredValue>;
}

const PER_GROUP = 6;
const VALUE_GROUP = 8;
const FIELD_GROUP = 8;

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
  structuredValues = [],
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

  // --- Fields (structured `key = value` filters) ---
  // System (@level / @source.*) and logical (~…) values match against value
  // or key/label and accept into a field filter rather than text.
  type FCand = StructuredValue & { rank: number };
  const fseen = new Set<string>();
  const fcands: FCand[] = [];
  for (const s of structuredValues) {
    if (s.value === '' || s.value.length > 80) continue;
    const vl = s.value.toLowerCase();
    const kl = `${s.key} ${s.label}`.toLowerCase();
    if (tokenCore !== '' && !vl.includes(tokenCore) && !kl.includes(tokenCore))
      continue;
    const dk = `${s.key}=${vl}`;
    if (fseen.has(dk)) continue;
    fseen.add(dk);
    const rank =
      tokenCore === ''
        ? 0
        : vl.startsWith(tokenCore) || kl.startsWith(tokenCore)
          ? 2
          : 1;
    fcands.push({ ...s, rank });
  }
  fcands.sort((a, b) => b.rank - a.rank || b.count - a.count);
  for (const c of fcands.slice(0, FIELD_GROUP)) {
    out.push({
      kind: 'field',
      group: 'Fields',
      label: `${c.key} = ${c.value}`,
      hint: c.count > 0 ? String(c.count) : undefined,
      filter: { key: c.key, value: c.value },
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
