import { describe, expect, it } from 'vitest';
import type { EntryId, SourceId } from '../types/log-entry.ts';
import type { ParseCtx } from '../types/log-parser.ts';
import { jsonLinesParser } from './json-lines-parser.ts';

const makeCtx = (sourceId = 'src-1'): ParseCtx => {
  let seq = 0;
  let nextEntry = 0;
  return {
    sourceId: sourceId as SourceId,
    nextId: () => `e-${++nextEntry}` as EntryId,
    nextSeq: () => seq++,
    now: () => 0,
  };
};

describe('jsonLinesParser', () => {
  describe('canParse', () => {
    it('accepts lines starting with {', () => {
      expect(jsonLinesParser.canParse('{"foo":1}')).toBe(true);
      expect(jsonLinesParser.canParse('   {"foo":1}')).toBe(true);
    });

    it('rejects non-json starts', () => {
      expect(jsonLinesParser.canParse('plain text')).toBe(false);
      expect(jsonLinesParser.canParse('[1,2]')).toBe(false);
    });
  });

  describe('parseLine', () => {
    it('extracts message, level, timestamp from common JSON shape', () => {
      const ctx = makeCtx();
      const result = jsonLinesParser.parseLine(
        '{"ts":"2024-01-01T10:00:00Z","level":"info","msg":"hello"}',
        ctx,
      );
      expect(result.entry).not.toBeNull();
      expect(result.entry!.message).toBe('hello');
      expect(result.entry!.level).toBe('info');
      expect(result.entry!.timestamp).toBe(Date.parse('2024-01-01T10:00:00Z'));
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('normalizes Pino numeric levels (10/20/30/40/50/60)', () => {
      const ctx = makeCtx();
      const cases: Array<[number, string]> = [
        [10, 'trace'],
        [20, 'debug'],
        [30, 'info'],
        [40, 'warn'],
        [50, 'error'],
        [60, 'fatal'],
      ];
      for (const [num, expected] of cases) {
        const r = jsonLinesParser.parseLine(`{"level":${num},"msg":"x"}`, ctx);
        expect(r.entry?.level).toBe(expected);
      }
    });

    it('normalizes string levels (warning, err, critical, ...)', () => {
      const ctx = makeCtx();
      const cases: Array<[string, string]> = [
        ['warning', 'warn'],
        ['err', 'error'],
        ['critical', 'fatal'],
        ['notice', 'info'],
        ['verbose', 'debug'],
      ];
      for (const [input, expected] of cases) {
        const r = jsonLinesParser.parseLine(
          `{"level":"${input}","msg":"x"}`,
          ctx,
        );
        expect(r.entry?.level).toBe(expected);
      }
    });

    it('falls back to "unknown" for missing/unrecognized levels', () => {
      const ctx = makeCtx();
      const r1 = jsonLinesParser.parseLine('{"msg":"x"}', ctx);
      expect(r1.entry?.level).toBe('unknown');
      const r2 = jsonLinesParser.parseLine(
        '{"level":"banana","msg":"x"}',
        ctx,
      );
      expect(r2.entry?.level).toBe('unknown');
    });

    it('handles epoch seconds vs milliseconds heuristically', () => {
      const ctx = makeCtx();
      const sec = jsonLinesParser.parseLine('{"ts":1700000000,"msg":"x"}', ctx);
      const ms = jsonLinesParser.parseLine(
        '{"ts":1700000000123,"msg":"x"}',
        ctx,
      );
      expect(sec.entry?.timestamp).toBe(1700000000_000);
      expect(ms.entry?.timestamp).toBe(1700000000_123);
    });

    it('mirrors the full JSON object into fields (including well-known keys)', () => {
      const ctx = makeCtx();
      const r = jsonLinesParser.parseLine(
        '{"level":"info","msg":"x","userId":42,"req":{"path":"/a"}}',
        ctx,
      );
      expect(r.entry?.fields).toEqual({
        level: 'info',
        msg: 'x',
        userId: 42,
        req: { path: '/a' },
      });
    });

    it('returns null for invalid JSON', () => {
      const ctx = makeCtx();
      const r = jsonLinesParser.parseLine('{ not json', ctx);
      expect(r.entry).toBeNull();
      expect(r.confidence).toBe(0);
    });

    it('returns null for empty/whitespace lines', () => {
      const ctx = makeCtx();
      expect(jsonLinesParser.parseLine('', ctx).entry).toBeNull();
      expect(jsonLinesParser.parseLine('   ', ctx).entry).toBeNull();
    });

    it('rejects arrays and primitives at top level', () => {
      const ctx = makeCtx();
      expect(jsonLinesParser.parseLine('[1,2,3]', ctx).entry).toBeNull();
      expect(jsonLinesParser.parseLine('"plain"', ctx).entry).toBeNull();
      expect(jsonLinesParser.parseLine('null', ctx).entry).toBeNull();
    });

    it('coerces non-string message via JSON.stringify', () => {
      const ctx = makeCtx();
      const r = jsonLinesParser.parseLine(
        '{"level":"info","msg":{"a":1}}',
        ctx,
      );
      expect(r.entry?.message).toBe('{"a":1}');
    });
  });
});
