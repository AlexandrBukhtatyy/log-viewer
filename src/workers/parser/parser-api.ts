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

    // For sources with inner file structure (directory / snapshot), the
    // adapter tags every frame with a relative `path`, and the orchestrator
    // groups frames by path before calling parse(). We attach the path to
    // entry.fields.file_path here, after the parser runs, so every parser
    // implementation gets it for free without per-parser plumbing.
    const filePath = ctx.filePath;
    const tag = (entry: LogEntry): LogEntry =>
      filePath === undefined
        ? entry
        : { ...entry, fields: { ...entry.fields, file_path: filePath } };

    const result: LogEntry[] = [];
    for (const line of lines) {
      if (line === '') continue;
      const { entry } = primary.parseLine(line, parseCtx);
      if (entry !== null) {
        result.push(tag(entry));
        continue;
      }
      const fallback = registry.parseAny(line, parseCtx);
      if (fallback !== null) result.push(tag(fallback));
    }
    return result;
  },
};
