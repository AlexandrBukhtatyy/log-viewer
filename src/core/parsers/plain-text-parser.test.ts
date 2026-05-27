import { describe, expect, it } from 'vitest';
import type { EntryId, SourceId } from '../types/log-entry.ts';
import type { ParseCtx } from '../types/log-parser.ts';
import { plainTextParser } from './plain-text-parser.ts';

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

describe('plainTextParser', () => {
  it('always claims canParse', () => {
    expect(plainTextParser.canParse('')).toBe(true);
    expect(plainTextParser.canParse('anything')).toBe(true);
  });

  it('produces entry with level=unknown, timestamp=null, raw=message', () => {
    const ctx = makeCtx();
    const { entry } = plainTextParser.parseLine('hello world', ctx);
    expect(entry).not.toBeNull();
    expect(entry!.level).toBe('unknown');
    expect(entry!.timestamp).toBeNull();
    expect(entry!.message).toBe('hello world');
    expect(entry!.raw).toBe('hello world');
  });

  it('drops empty lines', () => {
    const ctx = makeCtx();
    expect(plainTextParser.parseLine('', ctx).entry).toBeNull();
  });

  it('low confidence (fallback role)', () => {
    const ctx = makeCtx();
    const r = plainTextParser.parseLine('foo', ctx);
    expect(r.confidence).toBeLessThan(0.5);
  });

  it('tokenizes the line into positional $-keys split by whitespace', () => {
    const ctx = makeCtx();
    const { entry } = plainTextParser.parseLine(
      'ERROR 2024-01-15 user not found',
      ctx,
    );
    expect(entry!.fields).toEqual({
      $0: 'ERROR',
      $1: '2024-01-15',
      $2: 'user',
      $3: 'not',
      $4: 'found',
    });
  });

  it('collapses runs of whitespace and ignores leading/trailing spaces', () => {
    const ctx = makeCtx();
    const { entry } = plainTextParser.parseLine('  a\t\tb   c  ', ctx);
    expect(entry!.fields).toEqual({ $0: 'a', $1: 'b', $2: 'c' });
  });

  it('returns empty fields for a whitespace-only line', () => {
    const ctx = makeCtx();
    const { entry } = plainTextParser.parseLine('   \t  ', ctx);
    // The line is non-empty (raw) but has no tokens.
    expect(entry!.fields).toEqual({});
  });
});
