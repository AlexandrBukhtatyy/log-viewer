import type { LogParser } from '../types/log-parser.ts';
import { normalizeLevel } from './lib/level.ts';
import { parseTimestamp } from './lib/time.ts';

const TS_KEYS = ['ts', 'time', '@timestamp', 'timestamp', 'date'] as const;
const LEVEL_KEYS = ['level', 'severity', 'lvl', 'log.level'] as const;
const MSG_KEYS = ['msg', 'message', 'log'] as const;

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
    const ts = parseTimestamp(pickField(obj, TS_KEYS));
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
