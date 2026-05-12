import type { LogEntry, LogFilter, QueryMode } from '../types/index.ts';

/**
 * Free-text query matcher applied to fully-resolved entries (after the
 * lazy resolver has filled in `raw`/`message`).
 *
 * Why post-resolve and not SQL: ADR-0016 moved `raw`/`message` out of
 * SQLite into OPFS, so a `LIKE`/`REGEXP` push-down isn't possible
 * without re-storing the body or maintaining a separate index. Until
 * the FTS5 contentless index lands (Phase 1.2 of the multi-format
 * roadmap), substring/regex run in JS after resolve. This is a slow
 * path linear in matched-row count — acceptable for the current
 * working-set sizes; FTS will fast-path the common case.
 */

const escapeRegex = (s: string): string =>
  s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');

const compileSubstring = (q: string, caseSensitive: boolean, wholeWord: boolean): RegExp | null => {
  const pat = wholeWord ? `\\b(?:${escapeRegex(q)})\\b` : escapeRegex(q);
  try {
    return new RegExp(pat, caseSensitive ? '' : 'i');
  } catch {
    return null;
  }
};

const compileRegex = (q: string, caseSensitive: boolean, wholeWord: boolean): RegExp | null => {
  const pat = wholeWord ? `\\b(?:${q})\\b` : q;
  try {
    return new RegExp(pat, caseSensitive ? '' : 'i');
  } catch {
    return null;
  }
};

const compileFts = (q: string, caseSensitive: boolean, wholeWord: boolean): RegExp | null => {
  // Until the dedicated FTS5 path is wired we approximate FTS as a
  // substring fallback so the UI keeps returning results when the user
  // flips the toggle. The Phase 1.2 indexer path will replace this.
  return compileSubstring(q, caseSensitive, wholeWord);
};

export interface CompiledQuery {
  readonly mode: QueryMode;
  readonly test: (text: string) => boolean;
}

/**
 * Build a callable matcher from the free-text portion of a `LogFilter`.
 * Returns `null` when the filter has no query (the caller should skip
 * filtering entirely in that case to keep the fast path unchanged).
 */
export const compileFreeTextQuery = (filter: LogFilter): CompiledQuery | null => {
  const q = filter.query.trim();
  if (q === '') return null;
  const re =
    filter.queryMode === 'regex'
      ? compileRegex(q, filter.caseSensitive, filter.wholeWord)
      : filter.queryMode === 'fts'
        ? compileFts(q, filter.caseSensitive, filter.wholeWord)
        : compileSubstring(q, filter.caseSensitive, filter.wholeWord);
  if (re === null) {
    // Malformed user input (typically a broken regex). Treat as a
    // "matches nothing" filter so the UI shows an empty result rather
    // than silently dropping the constraint.
    return { mode: filter.queryMode, test: () => false };
  }
  return { mode: filter.queryMode, test: (text) => re.test(text) };
};

/**
 * Decide whether an entry survives the free-text predicate. We match
 * against `raw` (preserves the original line bytes — needed for log
 * formats whose value-of-interest lives outside the rendered
 * `message`, like nginx access logs) with a fallback to `message`.
 */
export const matchesFreeText = (entry: LogEntry, q: CompiledQuery): boolean => {
  if (entry.raw && q.test(entry.raw)) return true;
  if (entry.message && q.test(entry.message)) return true;
  return false;
};
