import type { LogLevel } from '../../types/log-entry.ts';
import type { LogParser } from '../../types/log-parser.ts';
import {
  levelFromHttpStatus,
  levelFromSyslogSeverity,
  normalizeLevel,
} from './level.ts';
import { parseApacheTime, parseSyslogTime, parseTimestamp } from './time.ts';

/**
 * Declarative regex-based parser. Lets reference parsers
 * (nginx/syslog/etc) and user-defined ones share the same wiring:
 * compile once, run `RegExp.exec`, hydrate fields by capture-group
 * index, derive level/timestamp from selected groups.
 *
 * One catch: capture groups are 1-indexed in JS regex match results,
 * matching how a human reads the pattern. We keep that convention
 * here — `fields[0].group === 1` refers to the first parenthesised
 * group.
 */

export type TransformId =
  | 'as-is'
  | 'number'
  | 'apache-time'
  | 'iso-time'
  | 'epoch-ms'
  | 'syslog-time';

const TRANSFORMS: Readonly<Record<TransformId, (raw: string) => unknown>> = {
  'as-is': (s) => s,
  number: (s) => {
    const n = Number(s);
    return Number.isFinite(n) ? n : s;
  },
  'apache-time': (s) => parseApacheTime(s),
  'iso-time': (s) => parseTimestamp(s),
  'epoch-ms': (s) => parseTimestamp(s),
  'syslog-time': (s) => parseSyslogTime(s),
};

export interface FieldBinding {
  /** 1-based capture-group index, matching the regex match array. */
  readonly group: number;
  readonly name: string;
  readonly transform?: TransformId;
}

export type LevelStrategy =
  | { kind: 'fixed'; value: LogLevel }
  | { kind: 'group-name'; group: number }
  | { kind: 'http-status'; group: number }
  | { kind: 'syslog-severity'; group: number };

export interface RegexParserSpec {
  readonly id: string;
  readonly pattern: RegExp;
  readonly fields: ReadonlyArray<FieldBinding>;
  /**
   * Optional capture-group whose value becomes `@ts`. If omitted, the
   * parser leaves `timestamp: null` — the indexer will fall back to
   * ingest-time clock.
   */
  readonly timestampGroup?: number;
  /**
   * Optional explicit timestamp transform. Defaults to `apache-time`
   * if the source pattern looks Apache-ish; callers can override to
   * `syslog-time`, `iso-time`, etc.
   */
  readonly timestampTransform?: TransformId;
  readonly level?: LevelStrategy;
  /**
   * Builds the rendered `message` from captured groups (1-indexed).
   * Defaults to the full original line — works for human-readable
   * formats; structured formats (nginx) usually override to a
   * compact summary like `"${method} ${uri} → ${status}"`.
   */
  readonly message?: (groups: ReadonlyArray<string | undefined>) => string;
  /** Confidence value reported back in `ParseResult`. */
  readonly confidence?: number;
  /** Forwarded to `LogParser.defaultColumns` — UI seeds column picker on first ingest. */
  readonly defaultColumns?: ReadonlyArray<string>;
}

const deriveLevel = (
  level: LevelStrategy | undefined,
  groups: ReadonlyArray<string | undefined>,
): LogLevel => {
  if (!level) return 'unknown';
  switch (level.kind) {
    case 'fixed':
      return level.value;
    case 'group-name':
      return normalizeLevel(groups[level.group]);
    case 'http-status': {
      const n = Number(groups[level.group]);
      return Number.isFinite(n) ? levelFromHttpStatus(n) : 'unknown';
    }
    case 'syslog-severity': {
      // RFC 3164 PRI byte packs `facility * 8 + severity` into one
      // number. Strip the facility before mapping to a LogLevel.
      const n = Number(groups[level.group]);
      return Number.isFinite(n) ? levelFromSyslogSeverity(n % 8) : 'unknown';
    }
  }
};

export const defineRegexParser = (spec: RegexParserSpec): LogParser => {
  // `canParse` runs against the first non-empty line of the source.
  // Reusing the same compiled RegExp object is fine because we don't
  // set the `g` flag — exec is stateless without it.
  const canParse = (line: string): boolean => spec.pattern.test(line);

  return {
    id: spec.id,
    canParse,
    defaultColumns: spec.defaultColumns,
    parseLine: (line, ctx) => {
      const m = spec.pattern.exec(line);
      if (m === null) {
        return { entry: null, confidence: 0 };
      }
      const fields: Record<string, unknown> = {};
      for (const binding of spec.fields) {
        const raw = m[binding.group];
        if (raw === undefined) continue;
        const t = binding.transform ?? 'as-is';
        const value = TRANSFORMS[t](raw);
        if (value !== null && value !== undefined && value !== '') {
          fields[binding.name] = value;
        }
      }
      const ts =
        spec.timestampGroup !== undefined
          ? (() => {
              const raw = m[spec.timestampGroup];
              if (raw === undefined) return null;
              const t = spec.timestampTransform ?? 'iso-time';
              const out = TRANSFORMS[t](raw);
              return typeof out === 'number' && Number.isFinite(out) ? out : null;
            })()
          : null;
      const message = spec.message ? spec.message(m) : line;
      return {
        entry: {
          id: ctx.nextId(),
          sourceId: ctx.sourceId,
          seq: ctx.nextSeq(),
          timestamp: ts,
          level: deriveLevel(spec.level, m),
          message,
          raw: line,
          fields,
        },
        confidence: spec.confidence ?? 0.9,
      };
    },
  };
};
