import type { LogParser } from '../types/log-parser.ts';

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
        fields: {},
      },
      confidence: 0.1,
    };
  },
};
