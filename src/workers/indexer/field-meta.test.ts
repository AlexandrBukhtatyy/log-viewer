import { describe, expect, it } from 'vitest';
import type {
  EntryId,
  LogEntry,
  LogLevel,
  SourceId,
} from '../../core/types/index.ts';
import {
  aggregateFieldMeta,
  FIELD_META_TOP_K,
  FIELD_META_VALUE_MAX_CHARS,
  inferFieldType,
  mergeFieldType,
  mergeTopValues,
  stringifyFieldValue,
} from './field-meta.ts';

const mkEntry = (
  sourceId: string,
  fields: Record<string, unknown>,
  level: LogLevel = 'info',
): LogEntry => ({
  id: ('e-' + Math.random().toString(36).slice(2)) as EntryId,
  sourceId: sourceId as SourceId,
  seq: 0,
  timestamp: 0,
  level,
  message: '',
  raw: '',
  fields,
  filePath: '',
  byteStart: 0,
  byteEnd: 0,
});

describe('inferFieldType', () => {
  it('classifies primitives', () => {
    expect(inferFieldType('hello')).toBe('string');
    expect(inferFieldType(42)).toBe('number');
    expect(inferFieldType(true)).toBe('boolean');
  });
  it('returns null for non-finite numbers and non-primitives', () => {
    expect(inferFieldType(NaN)).toBeNull();
    expect(inferFieldType(Infinity)).toBeNull();
    expect(inferFieldType(null)).toBeNull();
    expect(inferFieldType(undefined)).toBeNull();
    expect(inferFieldType({ x: 1 })).toBeNull();
    expect(inferFieldType([1, 2])).toBeNull();
  });
});

describe('stringifyFieldValue', () => {
  it('stringifies primitives lossless', () => {
    expect(stringifyFieldValue('hello')).toBe('hello');
    expect(stringifyFieldValue(42)).toBe('42');
    expect(stringifyFieldValue(true)).toBe('true');
  });
  it('returns empty string for null/undefined', () => {
    expect(stringifyFieldValue(null)).toBe('');
    expect(stringifyFieldValue(undefined)).toBe('');
  });
  it('JSON-encodes objects/arrays', () => {
    expect(stringifyFieldValue({ a: 1 })).toBe('{"a":1}');
    expect(stringifyFieldValue([1, 2])).toBe('[1,2]');
  });
});

describe('mergeFieldType', () => {
  it('null + single → that type', () => {
    expect(mergeFieldType(null, new Set(['string']))).toBe('string');
    expect(mergeFieldType(null, new Set(['number']))).toBe('number');
  });
  it('same + same → same', () => {
    expect(mergeFieldType('string', new Set(['string']))).toBe('string');
  });
  it('different existing vs incoming → mixed', () => {
    expect(mergeFieldType('string', new Set(['number']))).toBe('mixed');
  });
  it('multiple incoming types → mixed even if existing matches one', () => {
    expect(mergeFieldType('string', new Set(['string', 'number']))).toBe('mixed');
  });
  it('mixed sticks once it lands', () => {
    expect(mergeFieldType('mixed', new Set(['string']))).toBe('mixed');
    expect(mergeFieldType('mixed', new Set([]))).toBe('mixed');
  });
  it('null + empty → defaults to string (placeholder)', () => {
    expect(mergeFieldType(null, new Set())).toBe('string');
  });
  it('preserves existing when incoming has no concrete types', () => {
    expect(mergeFieldType('number', new Set())).toBe('number');
  });
});

describe('mergeTopValues', () => {
  it('returns sorted top entries from incoming when no existing blob', () => {
    const incoming = new Map([['a', 1], ['b', 5], ['c', 3]]);
    const out = mergeTopValues(null, incoming);
    expect(out).toEqual([
      { value: 'b', count: 5 },
      { value: 'c', count: 3 },
      { value: 'a', count: 1 },
    ]);
  });

  it('sums counters when value already in existing blob', () => {
    const existing = JSON.stringify([
      { value: 'b', count: 10 },
      { value: 'a', count: 1 },
    ]);
    const incoming = new Map([['b', 2], ['c', 1]]);
    const out = mergeTopValues(existing, incoming);
    // Ties on count fall back to insertion order: existing keys come first.
    expect(out).toEqual([
      { value: 'b', count: 12 },
      { value: 'a', count: 1 },
      { value: 'c', count: 1 },
    ]);
  });

  it('caps the result at FIELD_META_TOP_K', () => {
    const incoming = new Map<string, number>();
    for (let i = 0; i < FIELD_META_TOP_K + 5; i++) {
      incoming.set(`v${i}`, FIELD_META_TOP_K + 5 - i);
    }
    const out = mergeTopValues(null, incoming);
    expect(out).toHaveLength(FIELD_META_TOP_K);
    // First entries are the highest counts.
    expect(out[0]?.count).toBe(FIELD_META_TOP_K + 5);
  });

  it('treats corrupt existing blob as empty', () => {
    const out = mergeTopValues('not json', new Map([['a', 1]]));
    expect(out).toEqual([{ value: 'a', count: 1 }]);
  });
});

describe('aggregateFieldMeta', () => {
  it('counts occurrences per (source, key) and skips file_path', () => {
    const out = aggregateFieldMeta([
      mkEntry('s1', { trace_id: 't1', file_path: 'a.log' }),
      mkEntry('s1', { trace_id: 't2', service: 'api' }),
      mkEntry('s2', { trace_id: 't3' }),
    ]);
    expect(out.get('s1' as SourceId)?.size).toBe(2); // trace_id + service, file_path excluded
    expect(out.get('s1' as SourceId)?.get('trace_id')?.occurrences).toBe(2);
    expect(out.get('s1' as SourceId)?.get('service')?.occurrences).toBe(1);
    expect(out.get('s1' as SourceId)?.has('file_path')).toBe(false);
    expect(out.get('s2' as SourceId)?.get('trace_id')?.occurrences).toBe(1);
  });

  it('aggregates types from observed values', () => {
    const out = aggregateFieldMeta([
      mkEntry('s1', { status: 200 }),
      mkEntry('s1', { status: 500 }),
      mkEntry('s1', { status: 'error' }),
    ]);
    const types = out.get('s1' as SourceId)?.get('status')?.types;
    expect(types).toBeDefined();
    expect([...(types ?? [])].sort()).toEqual(['number', 'string']);
  });

  it('builds top-value counters', () => {
    const out = aggregateFieldMeta([
      mkEntry('s1', { service: 'api' }),
      mkEntry('s1', { service: 'api' }),
      mkEntry('s1', { service: 'billing' }),
    ]);
    const tv = out.get('s1' as SourceId)?.get('service')?.topVals;
    expect(tv?.get('api')).toBe(2);
    expect(tv?.get('billing')).toBe(1);
  });

  it('drops oversized values from top-list', () => {
    const big = 'x'.repeat(FIELD_META_VALUE_MAX_CHARS + 1);
    const out = aggregateFieldMeta([mkEntry('s1', { trace_id: big })]);
    const tv = out.get('s1' as SourceId)?.get('trace_id')?.topVals;
    expect(tv?.size).toBe(0);
    // occurrences still counted — only top-list excludes the long value.
    expect(out.get('s1' as SourceId)?.get('trace_id')?.occurrences).toBe(1);
  });
});
