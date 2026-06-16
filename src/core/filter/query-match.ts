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

const compileSubstring = (
  q: string,
  caseSensitive: boolean,
  wholeWord: boolean,
): RegExp | null => {
  const pat = wholeWord ? `\\b(?:${escapeRegex(q)})\\b` : escapeRegex(q);
  try {
    return new RegExp(pat, caseSensitive ? '' : 'i');
  } catch {
    return null;
  }
};

const compileRegex = (
  q: string,
  caseSensitive: boolean,
  wholeWord: boolean,
): RegExp | null => {
  const pat = wholeWord ? `\\b(?:${q})\\b` : q;
  try {
    return new RegExp(pat, caseSensitive ? '' : 'i');
  } catch {
    return null;
  }
};

// --- FTS: a small FTS5-like grammar evaluated on the read path ----------
//
// SQL-level FTS5 is gone after ADR-0016 (the body it indexed no longer
// lives in SQLite). Instead we parse the query into a boolean AST and
// evaluate it against the tokenised entry text. Supported subset:
//   - implicit AND between terms:  out of memory  → all present
//   - quoted phrases:              "out of memory" → contiguous tokens
//   - OR (lower precedence):       error OR warn
//   - negation:                    -debug   /  NOT debug
//   - prefix:                      time*    → token starts with "time"
// `wholeWord` has no effect in FTS mode — matching is already token-based.

type FtsNode =
  | { readonly t: 'term'; readonly value: string; readonly prefix: boolean }
  | { readonly t: 'phrase'; readonly tokens: ReadonlyArray<string> }
  | { readonly t: 'not'; readonly node: FtsNode }
  | { readonly t: 'and'; readonly nodes: ReadonlyArray<FtsNode> }
  | { readonly t: 'or'; readonly nodes: ReadonlyArray<FtsNode> };

const DOC_WORD_RE = /[\p{L}\p{N}_]+/gu;

const tokenizeText = (text: string, caseSensitive: boolean): string[] =>
  (caseSensitive ? text : text.toLowerCase()).match(DOC_WORD_RE) ?? [];

type QTok =
  | { readonly k: 'term'; readonly value: string; readonly prefix: boolean }
  | { readonly k: 'phrase'; readonly tokens: ReadonlyArray<string> }
  | { readonly k: 'or' }
  | { readonly k: 'not' };

/** Split the raw query into operator / term / phrase tokens. */
const lexFts = (q: string, caseSensitive: boolean): QTok[] => {
  const toks: QTok[] = [];
  let i = 0;
  while (i < q.length) {
    const ch = q[i]!;
    if (ch === ' ' || ch === '\t') {
      i++;
      continue;
    }
    if (ch === '"') {
      const end = q.indexOf('"', i + 1);
      const inner = end === -1 ? q.slice(i + 1) : q.slice(i + 1, end);
      toks.push({ k: 'phrase', tokens: tokenizeText(inner, caseSensitive) });
      i = end === -1 ? q.length : end + 1;
      continue;
    }
    // A bare run up to the next space or quote.
    let j = i;
    while (j < q.length && q[j] !== ' ' && q[j] !== '\t' && q[j] !== '"') j++;
    let run = q.slice(i, j);
    i = j;
    if (run === 'OR' || run === '|') {
      toks.push({ k: 'or' });
      continue;
    }
    if (run === 'NOT') {
      toks.push({ k: 'not' });
      continue;
    }
    // AND is the implicit conjunction — accept the explicit FTS5 keyword and
    // drop it (the surrounding terms are AND-ed anyway). Without this it would
    // be tokenised as the literal term "and" and poison the query.
    if (run === 'AND' || run === '&') continue;
    let negated = false;
    if (run.startsWith('-') && run.length > 1) {
      negated = true;
      run = run.slice(1);
    }
    const prefix = run.endsWith('*');
    if (prefix) run = run.slice(0, -1);
    // Keep only the word characters of the run (drop stray punctuation).
    const words = tokenizeText(run, caseSensitive);
    if (words.length === 0) continue;
    if (negated) toks.push({ k: 'not' });
    if (words.length === 1) {
      toks.push({ k: 'term', value: words[0]!, prefix });
    } else {
      // A run that tokenises to several words (e.g. `a.b`) behaves like a phrase.
      toks.push({ k: 'phrase', tokens: words });
    }
  }
  return toks;
};

/** Recursive-descent parser: OR is lowest precedence, then implicit AND,
 *  then unary NOT. Returns null when there is nothing to match. */
const parseFts = (toks: ReadonlyArray<QTok>): FtsNode | null => {
  let pos = 0;
  const peek = (): QTok | undefined => toks[pos];

  const parsePrimary = (): FtsNode | null => {
    const tok = peek();
    if (tok === undefined) return null;
    if (tok.k === 'term') {
      pos++;
      return { t: 'term', value: tok.value, prefix: tok.prefix };
    }
    if (tok.k === 'phrase') {
      pos++;
      return tok.tokens.length === 0
        ? null
        : { t: 'phrase', tokens: tok.tokens };
    }
    return null;
  };

  const parseUnary = (): FtsNode | null => {
    if (peek()?.k === 'not') {
      pos++;
      const node = parseUnary();
      return node === null ? null : { t: 'not', node };
    }
    return parsePrimary();
  };

  const parseAnd = (): FtsNode | null => {
    const nodes: FtsNode[] = [];
    for (;;) {
      const tok = peek();
      if (tok === undefined || tok.k === 'or') break;
      const node = parseUnary();
      if (node === null) {
        // Unconsumable token (defensive) — advance to avoid a loop.
        if (peek() === tok) pos++;
        continue;
      }
      nodes.push(node);
    }
    if (nodes.length === 0) return null;
    return nodes.length === 1 ? nodes[0]! : { t: 'and', nodes };
  };

  const parseOr = (): FtsNode | null => {
    const nodes: FtsNode[] = [];
    const first = parseAnd();
    if (first !== null) nodes.push(first);
    while (peek()?.k === 'or') {
      pos++;
      const next = parseAnd();
      if (next !== null) nodes.push(next);
    }
    if (nodes.length === 0) return null;
    return nodes.length === 1 ? nodes[0]! : { t: 'or', nodes };
  };

  return parseOr();
};

/** True when `tokens` contains the `phrase` as a contiguous subsequence. */
const containsPhrase = (
  tokens: ReadonlyArray<string>,
  phrase: ReadonlyArray<string>,
): boolean => {
  if (phrase.length === 0) return true;
  const last = tokens.length - phrase.length;
  for (let i = 0; i <= last; i++) {
    let ok = true;
    for (let j = 0; j < phrase.length; j++) {
      if (tokens[i + j] !== phrase[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
};

const evalFts = (
  node: FtsNode,
  tokens: ReadonlyArray<string>,
  set: ReadonlySet<string>,
): boolean => {
  switch (node.t) {
    case 'term':
      return node.prefix
        ? tokens.some((t) => t.startsWith(node.value))
        : set.has(node.value);
    case 'phrase':
      return containsPhrase(tokens, node.tokens);
    case 'not':
      return !evalFts(node.node, tokens, set);
    case 'and':
      return node.nodes.every((n) => evalFts(n, tokens, set));
    case 'or':
      return node.nodes.some((n) => evalFts(n, tokens, set));
  }
};

/**
 * Compile an FTS query into a predicate over arbitrary text. Returns
 * `null` when the query has no matchable terms (caller treats that as
 * "matches nothing").
 */
const compileFts = (
  q: string,
  caseSensitive: boolean,
): ((text: string) => boolean) | null => {
  const ast = parseFts(lexFts(q, caseSensitive));
  if (ast === null) return null;
  return (text: string): boolean => {
    const tokens = tokenizeText(text, caseSensitive);
    return evalFts(ast, tokens, new Set(tokens));
  };
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
export const compileFreeTextQuery = (
  filter: LogFilter,
): CompiledQuery | null => {
  const q = filter.query.trim();
  if (q === '') return null;
  if (filter.queryMode === 'fts') {
    const pred = compileFts(q, filter.caseSensitive);
    // No matchable terms (e.g. only operators) → show nothing rather than
    // silently dropping the constraint.
    return { mode: 'fts', test: pred ?? (() => false) };
  }
  const re =
    filter.queryMode === 'regex'
      ? compileRegex(q, filter.caseSensitive, filter.wholeWord)
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
