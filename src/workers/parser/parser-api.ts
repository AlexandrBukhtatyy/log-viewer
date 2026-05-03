import { createDefaultRegistry } from '../../core/parsers/index.ts';
import type { ParserApi, ParseRequestCtx } from '../../core/rpc/parser.contract.ts';
import type { LogEntry } from '../../core/types/log-entry.ts';
import type { ParseCtx } from '../../core/types/log-parser.ts';
import { newEntryId } from '../../core/util/ids.ts';

const WORKER_ID = crypto.randomUUID();
const registry = createDefaultRegistry();

const buildCtx = (req: ParseRequestCtx): ParseCtx => {
  let seq = req.startSeq;
  return {
    sourceId: req.sourceId,
    nextId: newEntryId,
    nextSeq: () => seq++,
    now: () => Date.now(),
  };
};

export const parserApi: ParserApi = {
  ping: async () => `parser-worker:${WORKER_ID}`,

  detectParser: async (sample) => registry.pick(sample).id,

  parse: async (lines, ctx) => {
    const parseCtx = buildCtx(ctx);
    const primary = ctx.parserId
      ? (registry.pickById(ctx.parserId) ?? registry.pick(lines))
      : registry.pick(lines);

    const result: LogEntry[] = [];
    for (const line of lines) {
      if (line === '') continue;
      const { entry } = primary.parseLine(line, parseCtx);
      if (entry !== null) {
        result.push(entry);
        continue;
      }
      const fallback = registry.parseAny(line, parseCtx);
      if (fallback !== null) result.push(fallback);
    }
    return result;
  },
};
