import { createDefaultRegistry } from '../../core/parsers/index.ts';
import { compileCustomParser } from '../../core/parsers/custom-parser-def.ts';
import type { CustomParserDef } from '../../core/parsers/custom-parser-def.ts';
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

/** Ids of custom parsers currently registered — used by `loadCustomParsers` to unregister stale entries. */
const customParserIds = new Set<string>();

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

  getParserMeta: async (parserId) => {
    const parser = registry.pickById(parserId);
    if (parser === null) return null;
    return {
      id: parser.id,
      continuationRegex: parser.continuationRegex ?? null,
      defaultColumns: parser.defaultColumns ?? [],
    };
  },

  listParsers: async () =>
    registry.list().map((p) => ({
      id: p.id,
      continuationRegex: p.continuationRegex ?? null,
      defaultColumns: p.defaultColumns ?? [],
    })),

  loadCustomParsers: async (defs: ReadonlyArray<CustomParserDef>) => {
    // Drop previously-registered custom parsers so an upsert/remove
    // doesn't leave a stale ghost in the registry. Re-register from
    // scratch — cheap, definitions are small and few.
    for (const id of customParserIds) registry.unregister(id);
    customParserIds.clear();
    for (const def of defs) {
      const parser = compileCustomParser(def);
      if (parser === null) continue;
      registry.register(parser, 50);
      customParserIds.add(parser.id);
    }
  },

  parse: async (frames, ctx) => {
    const parseCtx = buildCtx(ctx);
    const sample = samplesFromFrames(frames);
    const primary = ctx.parserId
      ? (registry.pickById(ctx.parserId) ?? registry.pick(sample))
      : registry.pick(sample);

    // For sources with inner file structure (directory / snapshot), the
    // adapter tags every frame with a relative `path`, and the orchestrator
    // groups frames by path before calling parse(). We stamp it onto
    // `LogEntry.filePath` (and the `entry.file_path` SQL column) — the
    // `@file` built-in field key reads from that column directly, so
    // there's no need to also dupe the value into `entry.fields`
    // (which is reserved for data extracted from the log line itself,
    // per ADR-0028).
    const filePath = ctx.filePath;
    const enrich = (
      record: ParsedRecord,
      byteStart: number,
      byteEnd: number,
      lineNumber: number,
    ): LogEntry => ({
      ...record,
      // Pre-serialize here so the indexer's serial insertBatch loop
      // doesn't pay JSON.stringify on every row — this work runs in
      // the parallel parser-pool instead.
      fieldsJson: JSON.stringify(record.fields),
      filePath: filePath ?? '',
      byteStart,
      byteEnd,
      lineNumber,
      // `fileSeq` is assigned by the orchestrator once it sees the
      // returned entries in file order — the parser doesn't know about
      // pre-existing records in the file, so it can't number them.
      fileSeq: 0,
    });

    const result: LogEntry[] = [];
    for (const frame of frames) {
      if (frame.line === '') continue;
      const { entry } = primary.parseLine(frame.line, parseCtx);
      if (entry !== null) {
        result.push(
          enrich(entry, frame.byteStart, frame.byteEnd, frame.lineNumber),
        );
        continue;
      }
      const fallback = registry.parseAny(frame.line, parseCtx);
      if (fallback !== null) {
        result.push(
          enrich(fallback, frame.byteStart, frame.byteEnd, frame.lineNumber),
        );
      }
    }
    return result;
  },
};
