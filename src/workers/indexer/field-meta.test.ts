import { describe, expect, it } from 'vitest';
import type {
  EntryId,
  LogEntry,
  LogLevel,
  SourceId,
} from '../../core/types/index.ts';
import {
  aggregateFieldDescriptors,
  aggregateFieldMeta,
  FIELD_META_TOP_K,
  FIELD_META_VALUE_MAX_CHARS,
  type FieldMetaRow,
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
  lineNumber: 0,
  fileSeq: 0,
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

describe('aggregateFieldDescriptors', () => {
  const row = (overrides: Partial<FieldMetaRow>): FieldMetaRow => ({
    source_id: 's1',
    key: 'k',
    type: 'string',
    occurrences: 0,
    total_seen: 0,
    top_values_json: null,
    ...overrides,
  });

  it('empty input → empty output', () => {
    expect(aggregateFieldDescriptors([])).toEqual([]);
  });

  it('single row → one descriptor with presenceRate and topValues', () => {
    const out = aggregateFieldDescriptors([
      row({
        key: 'service',
        type: 'string',
        occurrences: 4,
        total_seen: 10,
        top_values_json: JSON.stringify([
          { value: 'api', count: 3 },
          { value: 'billing', count: 1 },
        ]),
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      key: 'service',
      label: 'service',
      type: 'string',
      origin: 'dynamic',
      occurrences: 4,
      presenceRate: 0.4,
      topValues: [
        { value: 'api', count: 3 },
        { value: 'billing', count: 1 },
      ],
      perSource: [{ sourceId: 's1', occurrences: 4, presenceRate: 0.4 }],
    });
  });

  it('builds perSource breakdown when same key appears in multiple sources', () => {
    const out = aggregateFieldDescriptors([
      row({ source_id: 's1', key: 'req_id', occurrences: 500, total_seen: 500 }),
      row({ source_id: 's2', key: 'req_id', occurrences: 100, total_seen: 800 }),
    ]);
    expect(out[0]?.perSource).toEqual([
      { sourceId: 's1', occurrences: 500, presenceRate: 1 },
      { sourceId: 's2', occurrences: 100, presenceRate: 0.125 },
    ]);
  });

  it('groups perSource entries by source_id even when the row order is mixed', () => {
    const out = aggregateFieldDescriptors([
      row({ source_id: 's1', key: 'k', occurrences: 1, total_seen: 1 }),
      row({ source_id: 's2', key: 'k', occurrences: 2, total_seen: 2 }),
      row({ source_id: 's1', key: 'k', occurrences: 3, total_seen: 3 }),
    ]);
    const bySid = new Map(out[0]?.perSource?.map((p) => [p.sourceId, p]) ?? []);
    expect(bySid.get('s1')?.occurrences).toBe(4);
    expect(bySid.get('s2')?.occurrences).toBe(2);
  });

  it('sums occurrences and merges top values across sources for the same key', () => {
    const out = aggregateFieldDescriptors([
      row({
        key: 'service',
        type: 'string',
        occurrences: 3,
        total_seen: 10,
        top_values_json: JSON.stringify([{ value: 'api', count: 3 }]),
      }),
      row({
        key: 'service',
        type: 'string',
        occurrences: 2,
        total_seen: 5,
        top_values_json: JSON.stringify([
          { value: 'api', count: 1 },
          { value: 'billing', count: 1 },
        ]),
      }),
    ]);
    expect(out[0]?.occurrences).toBe(5);
    expect(out[0]?.presenceRate).toBe(5 / 15);
    expect(out[0]?.topValues).toEqual([
      { value: 'api', count: 4 },
      { value: 'billing', count: 1 },
    ]);
  });

  it('collapses to mixed when multiple concrete types appear', () => {
    const out = aggregateFieldDescriptors([
      row({ key: 'status', type: 'string', occurrences: 1, total_seen: 1 }),
      row({ key: 'status', type: 'number', occurrences: 1, total_seen: 1 }),
    ]);
    expect(out[0]?.type).toBe('mixed');
  });

  it('preserves mixed once seen, regardless of later concrete types', () => {
    const out = aggregateFieldDescriptors([
      row({ key: 'x', type: 'mixed', occurrences: 1, total_seen: 1 }),
      row({ key: 'x', type: 'string', occurrences: 1, total_seen: 1 }),
    ]);
    expect(out[0]?.type).toBe('mixed');
  });

  it('sorts descriptors by occurrences DESC then key A→Z', () => {
    const out = aggregateFieldDescriptors([
      row({ key: 'b', occurrences: 5, total_seen: 5 }),
      row({ key: 'a', occurrences: 5, total_seen: 5 }),
      row({ key: 'c', occurrences: 9, total_seen: 9 }),
    ]);
    expect(out.map((d) => d.key)).toEqual(['c', 'a', 'b']);
  });

  it('skips empty key and tolerates corrupt top_values_json', () => {
    const out = aggregateFieldDescriptors([
      row({ key: '', occurrences: 1, total_seen: 1 }),
      row({ key: 'k', occurrences: 1, total_seen: 1, top_values_json: 'not json' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.topValues).toBeUndefined();
  });

  it('omits presenceRate when total_seen is zero', () => {
    const out = aggregateFieldDescriptors([
      row({ key: 'k', occurrences: 0, total_seen: 0 }),
    ]);
    expect(out[0]?.presenceRate).toBeUndefined();
  });

  it('caps merged topValues at FIELD_META_TOP_K', () => {
    const items = Array.from({ length: FIELD_META_TOP_K + 5 }, (_, i) => ({
      value: `v${i}`,
      count: FIELD_META_TOP_K + 5 - i,
    }));
    const out = aggregateFieldDescriptors([
      row({
        key: 'k',
        occurrences: 1,
        total_seen: 1,
        top_values_json: JSON.stringify(items),
      }),
    ]);
    expect(out[0]?.topValues).toHaveLength(FIELD_META_TOP_K);
  });
});
