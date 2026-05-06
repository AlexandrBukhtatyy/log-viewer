import { createDefaultRegistry } from '../../core/parsers/index.ts';
import type {
  ParseLineFrame,
  ParserApi,
  ParseRequestCtx,
} from '../../core/rpc/parser.contract.ts';
import type { LogEntry, ParsedRecord } from '../../core/types/log-entry.ts';
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

const samplesFromFrames = (
  frames: ReadonlyArray<ParseLineFrame>,
): ReadonlyArray<string> => frames.map((f) => f.line);

export const parserApi: ParserApi = {
  ping: async () => `parser-worker:${WORKER_ID}`,

  detectParser: async (sample) => registry.pick(sample).id,

  parse: async (frames, ctx) => {
    const parseCtx = buildCtx(ctx);
    const sample = samplesFromFrames(frames);
    const primary = ctx.parserId
      ? (registry.pickById(ctx.parserId) ?? registry.pick(sample))
      : registry.pick(sample);

    // For sources with inner file structure (directory / snapshot), the
    // adapter tags every frame with a relative `path`, and the orchestrator
    // groups frames by path before calling parse(). We attach the path to
    // entry.fields.file_path here so every parser implementation gets it
    // for free without per-parser plumbing.
    const filePath = ctx.filePath;
    const enrich = (
      record: ParsedRecord,
      byteStart: number,
      byteEnd: number,
    ): LogEntry => ({
      ...record,
      fields:
        filePath === undefined
          ? record.fields
          : { ...record.fields, file_path: filePath },
      filePath: filePath ?? '',
      byteStart,
      byteEnd,
    });

    const result: LogEntry[] = [];
    for (const frame of frames) {
      if (frame.line === '') continue;
      const { entry } = primary.parseLine(frame.line, parseCtx);
      if (entry !== null) {
        result.push(enrich(entry, frame.byteStart, frame.byteEnd));
        continue;
      }
      const fallback = registry.parseAny(frame.line, parseCtx);
      if (fallback !== null) {
        result.push(enrich(fallback, frame.byteStart, frame.byteEnd));
      }
    }
    return result;
  },
};
