import type { LogLevel } from '../types/log-entry.ts';
import type { LogParser } from '../types/log-parser.ts';

const TS_KEYS = ['ts', 'time', '@timestamp', 'timestamp', 'date'] as const;
const LEVEL_KEYS = ['level', 'severity', 'lvl', 'log.level'] as const;
const MSG_KEYS = ['msg', 'message', 'log'] as const;

const PINO_LEVEL_NUMERIC: Readonly<Record<number, LogLevel>> = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
};

const SYSLOG_LEVEL_NUMERIC: Readonly<Record<number, LogLevel>> = {
  0: 'fatal',
  1: 'fatal',
  2: 'error',
  3: 'error',
  4: 'warn',
  5: 'info',
  6: 'info',
  7: 'debug',
};

const normalizeLevel = (value: unknown): LogLevel => {
  if (typeof value === 'number') {
    return PINO_LEVEL_NUMERIC[value] ?? SYSLOG_LEVEL_NUMERIC[value] ?? 'unknown';
  }
  if (typeof value !== 'string') return 'unknown';
  const v = value.trim().toLowerCase();
  switch (v) {
    case 'trace':
    case 'debug':
    case 'info':
    case 'warn':
    case 'error':
    case 'fatal':
      return v;
    case 'warning':
      return 'warn';
    case 'critical':
    case 'crit':
    case 'emergency':
    case 'emerg':
    case 'alert':
      return 'fatal';
    case 'err':
      return 'error';
    case 'inf':
    case 'information':
    case 'notice':
      return 'info';
    case 'dbg':
    case 'verbose':
      return 'debug';
    default:
      return 'unknown';
  }
};

const normalizeTimestamp = (value: unknown): number | null => {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e11 ? Math.floor(value * 1000) : Math.floor(value);
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const pickField = (
  obj: Record<string, unknown>,
  keys: ReadonlyArray<string>,
): unknown => {
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) {
      return obj[k];
    }
  }
  return undefined;
};

const stripWellKnown = (
  obj: Record<string, unknown>,
): Record<string, unknown> => {
  const out: Record<string, unknown> = { ...obj };
  for (const k of TS_KEYS) delete out[k];
  for (const k of LEVEL_KEYS) delete out[k];
  for (const k of MSG_KEYS) delete out[k];
  return out;
};

export const jsonLinesParser: LogParser = {
  id: 'json-lines',

  canParse: (line) => line.trimStart().startsWith('{'),

  parseLine: (line, ctx) => {
    const trimmed = line.trim();
    if (trimmed === '') {
      return { entry: null, confidence: 0 };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return { entry: null, confidence: 0 };
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return { entry: null, confidence: 0 };
    }
    const obj = parsed as Record<string, unknown>;
    const ts = normalizeTimestamp(pickField(obj, TS_KEYS));
    const level = normalizeLevel(pickField(obj, LEVEL_KEYS));
    const messageRaw = pickField(obj, MSG_KEYS);
    const message =
      typeof messageRaw === 'string'
        ? messageRaw
        : messageRaw === undefined
          ? ''
          : JSON.stringify(messageRaw);

    return {
      entry: {
        id: ctx.nextId(),
        sourceId: ctx.sourceId,
        seq: ctx.nextSeq(),
        timestamp: ts,
        level,
        message,
        raw: line,
        fields: stripWellKnown(obj),
      },
      confidence: 0.9,
    };
  },
};
