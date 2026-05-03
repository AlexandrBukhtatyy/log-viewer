import { describe, expect, it } from 'vitest';
import type { EntryId, SourceId } from '../types/log-entry.ts';
import type { ParseCtx } from '../types/log-parser.ts';
import { createDefaultRegistry, ParserRegistry } from './index.ts';

const makeCtx = (): ParseCtx => {
  let seq = 0;
  let id = 0;
  return {
    sourceId: 'src-1' as SourceId,
    nextId: () => `e-${++id}` as EntryId,
    nextSeq: () => seq++,
    now: () => 0,
  };
};

describe('ParserRegistry', () => {
  it('createDefaultRegistry registers json-lines (high prio) and plain-text (low)', () => {
    const reg = createDefaultRegistry();
    const ids = reg.list().map((p) => p.id);
    expect(ids).toEqual(['json-lines', 'plain-text']);
  });

  describe('pick', () => {
    it('picks json-lines when sample looks like JSON', () => {
      const reg = createDefaultRegistry();
      const picked = reg.pick(['{"a":1}', '...']);
      expect(picked.id).toBe('json-lines');
    });

    it('falls through to plain-text when sample is non-JSON', () => {
      const reg = createDefaultRegistry();
      const picked = reg.pick(['hello world', 'no JSON here']);
      expect(picked.id).toBe('plain-text');
    });

    it('skips empty/whitespace probes', () => {
      const reg = createDefaultRegistry();
      const picked = reg.pick(['', '   ', '{"a":1}']);
      expect(picked.id).toBe('json-lines');
    });

    it('throws when registry is completely empty', () => {
      const reg = new ParserRegistry();
      expect(() => reg.pick(['anything'])).toThrow();
    });
  });

  describe('pickById', () => {
    it('returns parser by id', () => {
      const reg = createDefaultRegistry();
      expect(reg.pickById('json-lines')?.id).toBe('json-lines');
    });

    it('returns null for unknown id', () => {
      const reg = createDefaultRegistry();
      expect(reg.pickById('nonexistent')).toBeNull();
    });
  });

  describe('parseAny', () => {
    it('falls through to plain-text when JSON parser declines', () => {
      const reg = createDefaultRegistry();
      const ctx = makeCtx();
      const entry = reg.parseAny('plain text line', ctx);
      expect(entry).not.toBeNull();
      expect(entry!.level).toBe('unknown');
    });

    it('preserves JSON parser result for valid JSON', () => {
      const reg = createDefaultRegistry();
      const ctx = makeCtx();
      const entry = reg.parseAny('{"level":"warn","msg":"alert"}', ctx);
      expect(entry?.message).toBe('alert');
      expect(entry?.level).toBe('warn');
    });
  });

  it('higher priority parser is consulted first', () => {
    const reg = new ParserRegistry();
    const captured: string[] = [];
    const trace = (id: string, accepts: boolean) => ({
      id,
      canParse: () => {
        captured.push(`canParse:${id}`);
        return accepts;
      },
      parseLine: (line: string, ctx: ParseCtx) => ({
        entry: {
          id: ctx.nextId(),
          sourceId: ctx.sourceId,
          seq: ctx.nextSeq(),
          timestamp: null,
          level: 'unknown' as const,
          message: line,
          raw: line,
          fields: {},
        },
        confidence: 1,
      }),
    });
    reg.register(trace('low', true), 0);
    reg.register(trace('high', true), 100);
    reg.parseAny('anything', makeCtx());
    expect(captured[0]).toBe('canParse:high');
  });
});
