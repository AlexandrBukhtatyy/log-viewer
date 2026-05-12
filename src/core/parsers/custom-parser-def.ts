import type { EntryId, LogLevel, SourceId } from '../types/log-entry.ts';
import type { LogParser, ParseCtx, ParseResult } from '../types/log-parser.ts';
import { compileGrok } from './lib/grok.ts';
import { normalizeLevel } from './lib/level.ts';
import {
  defineRegexParser,
  type FieldBinding,
  type LevelStrategy,
  type TransformId,
} from './lib/regex-parser.ts';
import { parseTimestamp } from './lib/time.ts';

/**
 * Persisted, user-editable parser definition (Phase 2.C of the
 * multi-format roadmap). Lives in IndexedDB under `custom-parsers`
 * and is compiled into a `LogParser` at registration time via
 * `compileCustomParser`. Currently supports `regex` and `grok`
 * kinds; `js-function` slot is reserved on the discriminator so
 * future migrations don't need a schema bump.
 */
export type CustomParserKind = 'regex' | 'grok' | 'js-function';

export interface CustomParserField {
  /** 1-based capture-group index. */
  readonly group: number;
  /** Target field name in `entry.fields`. */
  readonly name: string;
  readonly transform?: TransformId;
}

export interface CustomParserDef {
  readonly id: string;
  readonly label: string;
  readonly kind: CustomParserKind;
  /**
   * Pattern body. For `kind === 'regex'` — a raw JS regex source. For
   * `kind === 'grok'` — a grok expression like
   * `%{IP:client} %{NUMBER:status:int}`. Compiled via `compileGrok` at
   * registration time.
   */
  readonly pattern: string;
  /** Regex flags (`'i'`, `'m'`, …). Empty string means no flags. Ignored for grok. */
  readonly flags: string;
  /**
   * Field bindings — only meaningful for `kind === 'regex'`. Grok
   * derives its bindings from named tokens in the pattern at compile
   * time, so this stays empty for grok definitions.
   */
  readonly fields: ReadonlyArray<CustomParserField>;
  /**
   * Optional user-supplied tokens for grok mode (e.g.
   * `{ MYID: '[A-Z]{3}-\\d{4}' }`). Each value is itself a grok
   * source — can reference built-ins via `%{...}`.
   */
  readonly customTokens?: Readonly<Record<string, string>>;
  readonly timestampGroup?: number;
  readonly timestampTransform?: TransformId;
  /**
   * Grok-only: name of the captured field that holds the timestamp.
   * Resolved to `timestampGroup` at compile time. Falls back to a
   * binding called `@ts` when undefined.
   */
  readonly timestampField?: string;
  readonly levelStrategy?:
    | 'fixed'
    | 'group-name'
    | 'http-status'
    | 'syslog-severity';
  /** Capture-group index when `levelStrategy` needs one (regex mode). */
  readonly levelGroup?: number;
  /**
   * Grok-only: name of the captured field whose value drives `level`.
   * Resolved to `levelGroup` at compile time.
   */
  readonly levelField?: string;
  /** Used when `levelStrategy === 'fixed'`. */
  readonly levelFixed?: LogLevel;
  /**
   * Message template. For regex mode — `${n}` placeholders (1-based
   * group indices). For grok mode — `${name}` placeholders referring to
   * named captures. When undefined, the compiled parser leaves the
   * original line as `message`.
   */
  readonly messageTemplate?: string;
  readonly defaultColumns?: ReadonlyArray<string>;
  /** Bumped each save; used by Phase 2.C re-parse to detect changes. */
  readonly version: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

const buildLevelStrategy = (def: CustomParserDef): LevelStrategy | undefined => {
  switch (def.levelStrategy) {
    case 'fixed':
      return { kind: 'fixed', value: def.levelFixed ?? 'unknown' };
    case 'group-name':
      return def.levelGroup !== undefined
        ? { kind: 'group-name', group: def.levelGroup }
        : undefined;
    case 'http-status':
      return def.levelGroup !== undefined
        ? { kind: 'http-status', group: def.levelGroup }
        : undefined;
    case 'syslog-severity':
      return def.levelGroup !== undefined
        ? { kind: 'syslog-severity', group: def.levelGroup }
        : undefined;
    default:
      return undefined;
  }
};

/**
 * Build a message-renderer from `${n}` (group index) or `${name}` (named
 * binding) placeholders. The `nameToGroup` lookup is built once per
 * compile so each line stays O(tokens). When a token references an
 * unknown name, the placeholder is replaced with the empty string —
 * keeping the renderer total. For regex mode `nameToGroup` is empty,
 * so `${name}` falls through to nothing; grok-mode definitions pass a
 * full name-to-group map.
 */
const compileMessageTemplate = (
  template: string,
  nameToGroup: ReadonlyMap<string, number> = new Map(),
): ((groups: ReadonlyArray<string | undefined>) => string) => {
  type Token = { kind: 'lit'; v: string } | { kind: 'g'; n: number };
  const tokens: Token[] = [];
  const re = /\$\{([^}]+)\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) {
    if (m.index > last) tokens.push({ kind: 'lit', v: template.slice(last, m.index) });
    const ref = m[1];
    if (/^\d+$/.test(ref)) {
      tokens.push({ kind: 'g', n: Number(ref) });
    } else {
      const idx = nameToGroup.get(ref);
      // Unknown name → render as empty; we don't fail hard, the user
      // sees the dropped placeholder in the live test panel.
      tokens.push({ kind: 'g', n: idx ?? -1 });
    }
    last = m.index + m[0].length;
  }
  if (last < template.length) tokens.push({ kind: 'lit', v: template.slice(last) });
  return (groups) =>
    tokens
      .map((t) => (t.kind === 'lit' ? t.v : (t.n >= 0 ? (groups[t.n] ?? '') : '')))
      .join('');
};

/**
 * Compile a persisted definition into a runnable `LogParser`. Both
 * regex and grok kinds bottom out in `defineRegexParser` — grok just
 * runs through `compileGrok` first to derive the regex and binding
 * list from named tokens.
 *
 * Returns `null` when compilation fails — the caller
 * (registry-hydration code) surfaces this as a warning so a broken
 * parser doesn't tear the worker down.
 */
export const compileCustomParser = (def: CustomParserDef): LogParser | null => {
  if (def.kind === 'regex') {
    return compileRegexKind(def);
  }
  if (def.kind === 'grok') {
    return compileGrokKind(def);
  }
  if (def.kind === 'js-function') {
    return compileJsFunctionKind(def);
  }
  console.warn(
    `[custom-parser] kind '${def.kind}' not yet supported; skipping ${def.id}`,
  );
  return null;
};

/**
 * Shape the user function returns per line. `null` means "this parser
 * does not handle the line" — the orchestrator falls through to the
 * next registered parser. Everything else is coerced into a real
 * `LogEntry` via the helpers below so the user doesn't have to fill in
 * `id`/`seq`/`raw`.
 */
interface JsParseOutput {
  readonly timestamp?: number | string | null;
  readonly level?: string;
  readonly message?: string;
  readonly fields?: Record<string, unknown>;
}

type JsParseFn = (line: string, ctx: ParseCtx) => JsParseOutput | null | undefined;

const compileJsFunctionKind = (def: CustomParserDef): LogParser | null => {
  let fn: JsParseFn;
  try {
    // Safe-ish: the user is the developer of their own browser tab.
    // The function body runs inside the parser-pool worker — no DOM, no
    // window. Errors raised here surface as a `null` ParseResult.
    fn = new Function('line', 'ctx', def.pattern) as JsParseFn;
  } catch (err) {
    console.warn(
      `[custom-parser] js-function compile failed for '${def.id}'; skipping`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
  const confidence = 0.85;
  return {
    id: def.id,
    defaultColumns: def.defaultColumns,
    canParse: (line: string): boolean => {
      try {
        const out = fn(line, makeProbeCtx());
        return out !== null && out !== undefined;
      } catch {
        return false;
      }
    },
    parseLine: (line, ctx): ParseResult => {
      let out: JsParseOutput | null | undefined;
      try {
        out = fn(line, ctx);
      } catch (err) {
        // One bad line should not poison the whole batch — log once
        // and skip. Persistent errors will show up in worker console.
        console.warn(`[custom-parser] '${def.id}' threw on a line`, err);
        return { entry: null, confidence: 0 };
      }
      if (!out) {
        return { entry: null, confidence: 0 };
      }
      const ts =
        typeof out.timestamp === 'number'
          ? Number.isFinite(out.timestamp)
            ? out.timestamp
            : null
          : typeof out.timestamp === 'string'
            ? parseTimestamp(out.timestamp)
            : null;
      return {
        entry: {
          id: ctx.nextId(),
          sourceId: ctx.sourceId,
          seq: ctx.nextSeq(),
          timestamp: ts,
          level: normalizeLevel(out.level),
          message: typeof out.message === 'string' ? out.message : line,
          raw: line,
          fields: out.fields ?? {},
        },
        confidence,
      };
    },
  };
};

const makeProbeCtx = (): ParseCtx => ({
  // canParse runs the user function once at registry-detect time — we
  // don't have a real ctx then, so feed throwaway counters that match
  // the shape but never escape.
  sourceId: 'probe' as SourceId,
  nextId: () => 'probe-id' as EntryId,
  nextSeq: () => 0,
  now: () => Date.now(),
});

const compileRegexKind = (def: CustomParserDef): LogParser | null => {
  let pattern: RegExp;
  try {
    pattern = new RegExp(def.pattern, def.flags || '');
  } catch (err) {
    console.warn(
      `[custom-parser] invalid regex for '${def.id}'; skipping`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
  const fields: FieldBinding[] = def.fields.map((f) => ({
    group: f.group,
    name: f.name,
    transform: f.transform,
  }));
  return defineRegexParser({
    id: def.id,
    pattern,
    fields,
    timestampGroup: def.timestampGroup,
    timestampTransform: def.timestampTransform,
    level: buildLevelStrategy(def),
    message: def.messageTemplate
      ? compileMessageTemplate(def.messageTemplate)
      : undefined,
    confidence: 0.85,
    defaultColumns: def.defaultColumns,
  });
};

const compileGrokKind = (def: CustomParserDef): LogParser | null => {
  let compiled;
  try {
    compiled = compileGrok(def.pattern, def.customTokens ?? {});
  } catch (err) {
    console.warn(
      `[custom-parser] grok compile failed for '${def.id}'; skipping`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
  const nameToGroup = new Map(compiled.bindings.map((b) => [b.name, b.group]));
  const fields: FieldBinding[] = compiled.bindings.map((b) => ({
    group: b.group,
    name: b.name,
    transform: b.transform,
  }));
  // Translate name-based `timestampField`/`levelField` into the
  // group-index world `defineRegexParser` understands. Fall back to
  // the legacy numeric fields if both are absent.
  const tsGroup =
    def.timestampField !== undefined
      ? nameToGroup.get(def.timestampField)
      : (def.timestampGroup ?? nameToGroup.get('@ts'));
  const levelStrategyKey = def.levelStrategy;
  const levelGroup =
    def.levelField !== undefined
      ? nameToGroup.get(def.levelField)
      : (def.levelGroup ?? nameToGroup.get('@level'));
  const level: LevelStrategy | undefined = (() => {
    if (levelStrategyKey === undefined) return undefined;
    if (levelStrategyKey === 'fixed') {
      return { kind: 'fixed', value: def.levelFixed ?? 'unknown' };
    }
    if (levelGroup === undefined) return undefined;
    return { kind: levelStrategyKey, group: levelGroup };
  })();
  return defineRegexParser({
    id: def.id,
    pattern: compiled.pattern,
    fields,
    timestampGroup: tsGroup,
    timestampTransform: def.timestampTransform,
    level,
    message: def.messageTemplate
      ? compileMessageTemplate(def.messageTemplate, nameToGroup)
      : undefined,
    confidence: 0.85,
    defaultColumns: def.defaultColumns,
  });
};
