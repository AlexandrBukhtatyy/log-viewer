import { describe, expect, it } from 'vitest';
import type { LogEntry, EntryId, SourceId } from '../types/index.ts';
import { entryFingerprint, fnv1aHex } from './fingerprint.ts';

const mkEntry = (overrides: Partial<LogEntry> = {}): LogEntry => ({
  id: 'e-1' as EntryId,
  sourceId: 's-A' as SourceId,
  seq: 1,
  timestamp: 0,
  level: 'info',
  message: 'hello',
  raw: 'hello',
  fields: {},
  filePath: '',
  byteStart: 0,
  byteEnd: 5,
  lineNumber: 1,
  fileSeq: 1,
  ...overrides,
});

describe('fnv1aHex', () => {
  it('returns an 8-char lowercase hex string', () => {
    const h = fnv1aHex('hello world');
    expect(h).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is deterministic — same input → same output', () => {
    expect(fnv1aHex('foo')).toBe(fnv1aHex('foo'));
  });

  it('differs across distinct inputs (no trivial collisions on small alphabet)', () => {
    expect(fnv1aHex('a')).not.toBe(fnv1aHex('b'));
    expect(fnv1aHex('aa')).not.toBe(fnv1aHex('ab'));
  });
});

describe('entryFingerprint', () => {
  it('survives a fresh EntryId — equal raw + sourceId → equal fingerprint', () => {
    const a = mkEntry({ id: 'old-uuid' as EntryId, raw: 'X' });
    const b = mkEntry({ id: 'fresh-uuid' as EntryId, raw: 'X', seq: 999 });
    expect(entryFingerprint(a)).toBe(entryFingerprint(b));
  });

  it('changes when sourceId changes', () => {
    const a = mkEntry({ sourceId: 's-A' as SourceId });
    const b = mkEntry({ sourceId: 's-B' as SourceId });
    expect(entryFingerprint(a)).not.toBe(entryFingerprint(b));
  });

  it('changes when raw content changes', () => {
    const a = mkEntry({ raw: 'one' });
    const b = mkEntry({ raw: 'two' });
    expect(entryFingerprint(a)).not.toBe(entryFingerprint(b));
  });

  it('shape is `<sourceId>:<8-hex>`', () => {
    expect(entryFingerprint(mkEntry())).toMatch(/^s-A:[0-9a-f]{8}$/);
  });
});
