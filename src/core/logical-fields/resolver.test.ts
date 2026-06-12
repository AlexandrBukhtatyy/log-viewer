import { describe, expect, it } from 'vitest';
import type {
  EntryId,
  LogEntry,
  LogicalField,
  SourceId,
} from '../types/index.ts';
import { makeLogicalFieldResolver, resolveLogicalField } from './resolver.ts';

const makeEntry = (over: Partial<LogEntry> = {}): LogEntry => ({
  id: 'e1' as EntryId,
  sourceId: 's1' as SourceId,
  seq: 0,
  timestamp: 0,
  level: 'info',
  message: '',
  raw: '',
  fields: {},
  filePath: '',
  byteStart: 0,
  byteEnd: 0,
  lineNumber: 0,
  fileSeq: 0,
  ...over,
});

const field = (
  id: string,
  extractors: LogicalField['extractors'],
): LogicalField => ({
  id,
  type: 'string',
  label: id,
  origin: 'user',
  extractors,
});

describe('resolveLogicalField — field extractor', () => {
  it('reads a simple top-level path from fields', () => {
    const entry = makeEntry({ fields: { trace_id: 'abc' } });
    const f = field('trace_id', [{ type: 'field', path: 'trace_id' }]);
    expect(resolveLogicalField(entry, f)).toBe('abc');
  });

  it('resolves a dotted path as nested property lookup', () => {
    const entry = makeEntry({
      fields: { http: { status_code: 200 } },
    });
    const f = field('http.status', [
      { type: 'field', path: 'http.status_code' },
    ]);
    expect(resolveLogicalField(entry, f)).toBe(200);
  });

  it('returns null when the path is missing', () => {
    const entry = makeEntry({ fields: { other: 'x' } });
    const f = field('trace_id', [{ type: 'field', path: 'trace_id' }]);
    expect(resolveLogicalField(entry, f)).toBeNull();
  });

  it('returns null when traversing through a non-object', () => {
    const entry = makeEntry({ fields: { http: 'GET /foo' } });
    const f = field('http.status', [
      { type: 'field', path: 'http.status_code' },
    ]);
    expect(resolveLogicalField(entry, f)).toBeNull();
  });
});

describe('resolveLogicalField — regex extractor', () => {
  it('extracts a named capture from message', () => {
    const entry = makeEntry({ message: 'reqId=req_42 finished' });
    const f = field('request_id', [
      {
        type: 'regex',
        on: 'message',
        pattern: 'req[_-]?id[=:]\\s*(?<v>[\\w-]+)',
        flags: 'i',
        group: 'v',
      },
    ]);
    expect(resolveLogicalField(entry, f)).toBe('req_42');
  });

  it('falls back to capture group 1 when no group name is set', () => {
    const entry = makeEntry({ message: 'span=op-99 done' });
    const f = field('span_id', [
      { type: 'regex', on: 'message', pattern: 'span=(\\S+)' },
    ]);
    expect(resolveLogicalField(entry, f)).toBe('op-99');
  });

  it('returns null when the pattern does not match', () => {
    const entry = makeEntry({ message: 'nothing here' });
    const f = field('trace_id', [
      { type: 'regex', on: 'message', pattern: 'tr=(\\w+)' },
    ]);
    expect(resolveLogicalField(entry, f)).toBeNull();
  });

  it('reads from raw when on: raw', () => {
    const entry = makeEntry({ message: '', raw: 'tid=zzz inside' });
    const f = field('trace_id', [
      { type: 'regex', on: 'raw', pattern: 'tid=(?<v>\\w+)', group: 'v' },
    ]);
    expect(resolveLogicalField(entry, f)).toBe('zzz');
  });

  it('skips silently on a malformed regex (does not throw)', () => {
    const entry = makeEntry({ message: 'x' });
    const f = field('bad', [
      { type: 'regex', on: 'message', pattern: '(' },
    ]);
    expect(resolveLogicalField(entry, f)).toBeNull();
  });
});

describe('resolveLogicalField — chain semantics', () => {
  it('returns the first non-null extractor value', () => {
    const entry = makeEntry({ fields: { traceId: 'abc' } });
    const f = field('trace_id', [
      { type: 'field', path: 'trace_id' }, // null
      { type: 'field', path: 'traceId' },  // match
      { type: 'field', path: 'tid' },      // not reached
    ]);
    expect(resolveLogicalField(entry, f)).toBe('abc');
  });

  it('combines field + regex fallback', () => {
    const entry = makeEntry({
      fields: {},
      message: '... traceId=xyz finished',
    });
    const f = field('trace_id', [
      { type: 'field', path: 'trace_id' },
      {
        type: 'regex',
        on: 'message',
        pattern: 'traceId=(?<v>\\w+)',
        group: 'v',
      },
    ]);
    expect(resolveLogicalField(entry, f)).toBe('xyz');
  });

  it('returns null when every extractor misses', () => {
    const entry = makeEntry({ fields: {}, message: 'nothing' });
    const f = field('trace_id', [
      { type: 'field', path: 'trace_id' },
      { type: 'regex', on: 'message', pattern: 'tr=(\\w+)' },
    ]);
    expect(resolveLogicalField(entry, f)).toBeNull();
  });
});

describe('makeLogicalFieldResolver', () => {
  it('returns null for an unknown id', () => {
    const r = makeLogicalFieldResolver([
      field('trace_id', [{ type: 'field', path: 'trace_id' }]),
    ]);
    expect(r(makeEntry(), 'unknown')).toBeNull();
  });

  it('routes by id across a set of fields', () => {
    const r = makeLogicalFieldResolver([
      field('trace_id', [{ type: 'field', path: 'trace_id' }]),
      field('user_id', [{ type: 'field', path: 'usr.id' }]),
    ]);
    const entry = makeEntry({
      fields: { trace_id: 'T', usr: { id: 'U' } },
    });
    expect(r(entry, 'trace_id')).toBe('T');
    expect(r(entry, 'user_id')).toBe('U');
  });
});
