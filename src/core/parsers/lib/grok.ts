import { BUILTIN_GROK_PATTERNS, TOKEN_DEFAULT_TYPE } from './grok-patterns.ts';
import type { TransformId } from './regex-parser.ts';

/**
 * Compiled output of a grok pattern — a JS `RegExp` plus the list of
 * named bindings extracted from the source pattern. Each entry of
 * `bindings` carries the 1-based capture-group index so downstream
 * code (e.g. `defineRegexParser` / `compileCustomParser`) can pluck
 * the value out of `RegExp.exec` results without a second walk.
 */
export interface CompiledGrok {
  readonly pattern: RegExp;
  readonly bindings: ReadonlyArray<GrokBinding>;
}

export interface GrokBinding {
  readonly name: string;
  /** 1-based capture-group index in `pattern`. */
  readonly group: number;
  /**
   * Default transform — derived from the grok type suffix
   * (`%{INT:bytes:int}` → 'number') or the token's implicit type
   * (`%{NUMBER:bytes}` → 'number'). Falls back to `'as-is'` so
   * unrelated tokens like `%{WORD:method}` keep raw strings.
   */
  readonly transform: TransformId;
}

const TOKEN_RE = /%\{([A-Z][A-Z0-9_]*)(?::([^:}]+))?(?::([^}]+))?\}/g;

const transformForGrokType = (
  gtype: string | undefined,
): TransformId | null => {
  if (gtype === undefined) return null;
  switch (gtype) {
    case 'int':
    case 'long':
    case 'float':
    case 'number':
      return 'number';
    default:
      return null;
  }
};

const transformForToken = (token: string): TransformId | null => {
  const t = TOKEN_DEFAULT_TYPE[token];
  return t ? 'number' : null;
};

/**
 * Recursively expand `%{...}` tokens against the registry. Bindings
 * are collected from the *outer-most* references only; nested tokens
 * inside an expanded value stay anonymous (non-capturing `(?:...)`).
 *
 * Why outer-only: a single grok expression often references
 * composite tokens like `%{IPORHOST}` whose body itself contains
 * `%{IP}`. Capturing every level would produce dozens of unwanted
 * group indices and break the explicit `bindings` accounting.
 *
 * `customTokens` (per-definition) overrides `BUILTIN_GROK_PATTERNS`.
 * Cycles in the resolution graph throw a clear error rather than
 * recursing until the stack blows.
 */
const expand = (
  src: string,
  customTokens: Readonly<Record<string, string>>,
  resolving: ReadonlySet<string>,
): string => {
  return src.replace(TOKEN_RE, (_match, name: string) => {
    if (resolving.has(name)) {
      throw new Error(`grok: cyclic reference involving '${name}'`);
    }
    const body = customTokens[name] ?? BUILTIN_GROK_PATTERNS[name];
    if (body === undefined) {
      throw new Error(`grok: unknown token '${name}'`);
    }
    const next = new Set(resolving);
    next.add(name);
    // Inner expansions stay non-capturing so they don't bump the
    // group counter visible to the outer compile step.
    return `(?:${expand(body, customTokens, next)})`;
  });
};

/**
 * Compile a grok pattern to a JS regex + binding list. The pattern is
 * applied to whole lines, so we anchor it with `^…$` here — callers
 * shouldn't try to anchor a second time.
 *
 * Capturing-vs-non-capturing rules:
 *   - `%{TOKEN}`            → `(?:...)` (no binding, no index bump)
 *   - `%{TOKEN:name}`       → `(...)`   (binding; captures into `name`)
 *   - `%{TOKEN:name:type}`  → `(...)`   (binding; `type` selects transform)
 *
 * Throws on:
 *   - unknown tokens
 *   - cyclic custom tokens (`A` → `B`, `B` → `A`)
 *   - invalid resulting regex (caller catches; see `compileCustomParser`)
 */
export const compileGrok = (
  pattern: string,
  customTokens: Readonly<Record<string, string>> = {},
): CompiledGrok => {
  const bindings: GrokBinding[] = [];
  let groupIndex = 0;

  // First pass: build the regex source by walking the outer-most
  // tokens. Anonymous tokens get `(?:...)`; named ones get `(...)`
  // and a binding entry.
  const compiled = pattern.replace(
    TOKEN_RE,
    (_m, name: string, bind?: string, gtype?: string) => {
      const body = customTokens[name] ?? BUILTIN_GROK_PATTERNS[name];
      if (body === undefined) {
        throw new Error(`grok: unknown token '${name}'`);
      }
      const expanded = expand(body, customTokens, new Set([name]));
      if (bind === undefined) {
        return `(?:${expanded})`;
      }
      groupIndex += 1;
      const transform =
        transformForGrokType(gtype) ?? transformForToken(name) ?? 'as-is';
      bindings.push({ name: bind, group: groupIndex, transform });
      return `(${expanded})`;
    },
  );

  let regex: RegExp;
  try {
    regex = new RegExp(`^${compiled}$`);
  } catch (err) {
    throw new Error(
      `grok: invalid regex after expansion (${err instanceof Error ? err.message : String(err)})`,
      { cause: err },
    );
  }
  return { pattern: regex, bindings };
};
