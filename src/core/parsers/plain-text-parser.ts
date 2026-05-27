import type { LogParser } from '../types/log-parser.ts';

/**
 * Split the line into whitespace-separated tokens and map them into
 * positional fields `$0, $1, …`. Mirrors what structured parsers do —
 * `fields` always carries only data extracted from the log line, never
 * application metadata (`@`-attributes live on `LogEntry` itself and
 * are surfaced in the Meta tab; see ADR-0028).
 */
const tokenizePositional = (line: string): Record<string, string> => {
  const trimmed = line.trim();
  if (trimmed === '') return {};
  const tokens = trimmed.split(/\s+/);
  const out: Record<string, string> = {};
  for (let i = 0; i < tokens.length; i += 1) out[`$${i}`] = tokens[i]!;
  return out;
};

export const plainTextParser: LogParser = {
  id: 'plain-text',
  canParse: () => true,
  parseLine: (line, ctx) => {
    if (line === '') {
      return { entry: null, confidence: 0 };
    }
    return {
      entry: {
        id: ctx.nextId(),
        sourceId: ctx.sourceId,
        seq: ctx.nextSeq(),
        timestamp: null,
        level: 'unknown',
        message: line,
        raw: line,
        fields: tokenizePositional(line),
      },
      confidence: 0.1,
    };
  },
};
