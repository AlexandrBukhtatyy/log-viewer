import { describe, expect, it } from 'vitest';
import type {
  EntryId,
  LogEntry,
  LogicalField,
  LogLevel,
  SourceId,
} from '../types/index.ts';
import type { FieldFilterOp } from '../types/log-filter.ts';
import {
  aggregateBuckets,
  aggregateHistogram,
  makeBodyFilterPredicate,
  sortInPlaceByBodyField,
} from './read-path.ts';

const makeEntry = (over: Partial<LogEntry> = {}): LogEntry => ({
  id: ('e-' + Math.random().toString(36).slice(2)) as EntryId,
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

// `~v` resolves from fields.v — the predicate path (getEntryFieldValue →
// resolveLogicalField) is identical regardless of body-only-ness.
const vField: LogicalField = {
  id: 'v',
  type: 'string',
  label: 'v',
  origin: 'user',
  extractors: [{ type: 'field', path: 'v' }],
};
const ctx = { activeLogicalFields: [vField] };

const pred = (op: FieldFilterOp, value: string) =>
  makeBodyFilterPredicate([{ key: '~v', op, value }], ctx);

describe('makeBodyFilterPredicate — operator parity with SQL', () => {
  const withV = (v: unknown) =>
    makeEntry({ fields: v === undefined ? {} : { v } });

  it('= matches equal string, rejects others', () => {
    expect(pred('=', 'login')(withV('login'))).toBe(true);
    expect(pred('=', 'login')(withV('logout'))).toBe(false);
  });

  it('!= matches differing value but NOT a missing one (NULL semantics)', () => {
    expect(pred('!=', 'login')(withV('logout'))).toBe(true);
    expect(pred('!=', 'login')(withV('login'))).toBe(false);
    // The load-bearing case: missing value matches no operator, incl. !=.
    expect(pred('!=', 'login')(withV(undefined))).toBe(false);
  });

  it('~ is case-insensitive substring', () => {
    expect(pred('~', 'OG')(withV('login'))).toBe(true);
    expect(pred('~', 'xyz')(withV('login'))).toBe(false);
  });

  it('> and < compare numerically', () => {
    expect(pred('>', '10')(withV('11'))).toBe(true);
    expect(pred('>', '10')(withV('9'))).toBe(false);
    expect(pred('<', '10')(withV('9'))).toBe(true);
    expect(pred('<', '10')(withV('11'))).toBe(false);
  });

  it('missing value rejects every operator', () => {
    for (const op of ['=', '!=', '~', '>', '<'] as FieldFilterOp[]) {
      expect(pred(op, '5')(withV(undefined))).toBe(false);
    }
  });

  it('ANDs multiple filters', () => {
    const p = makeBodyFilterPredicate(
      [
        { key: '~v', op: '~', value: 'lo' },
        { key: '~v', op: '!=', value: 'logout' },
      ],
      ctx,
    );
    expect(p(makeEntry({ fields: { v: 'login' } }))).toBe(true);
    expect(p(makeEntry({ fields: { v: 'logout' } }))).toBe(false);
  });
});

describe('aggregateBuckets', () => {
  const ent = (v: string | null, level: LogLevel, ts: number | null) =>
    makeEntry({ fields: v === null ? {} : { v }, level, timestamp: ts });
  const groupV = (e: LogEntry): string | null =>
    (e.fields as { v?: string }).v ?? null;

  it('counts, tsMin/tsMax, levelCounts, ordered by count DESC then value ASC', () => {
    const buckets = aggregateBuckets(
      [ent('a', 'info', 30), ent('a', 'error', 10), ent('b', 'info', 20)],
      groupV,
    );
    expect(buckets).toEqual([
      {
        value: 'a',
        count: 2,
        tsMin: 10,
        tsMax: 30,
        levelCounts: { info: 1, error: 1 },
      },
      { value: 'b', count: 1, tsMin: 20, tsMax: 20, levelCounts: { info: 1 } },
    ]);
  });

  it('null (missing) bucket sorts first on count tie (SQLite NULL-low ASC)', () => {
    const buckets = aggregateBuckets(
      [ent('z', 'info', 5), ent(null, 'warn', 7)],
      groupV,
    );
    expect(buckets.map((b) => b.value)).toEqual([null, 'z']);
  });

  it('skips null timestamps in tsMin/tsMax', () => {
    const buckets = aggregateBuckets(
      [ent('a', 'info', null), ent('a', 'info', 42)],
      groupV,
    );
    expect(buckets[0]).toMatchObject({ tsMin: 42, tsMax: 42 });
  });

  it('null ts only → tsMin/tsMax null', () => {
    const buckets = aggregateBuckets([ent('a', 'info', null)], groupV);
    expect(buckets[0]).toMatchObject({ tsMin: null, tsMax: null });
  });

  it('clamps to the limit', () => {
    const entries = ['a', 'b', 'c', 'd'].map((v) => ent(v, 'info', 1));
    expect(aggregateBuckets(entries, groupV, 2)).toHaveLength(2);
  });
});

describe('sortInPlaceByBodyField', () => {
  const ent = (v: string | null, sourceId = 's1', seq = 0) =>
    makeEntry({
      fields: v === null ? {} : { v },
      sourceId: sourceId as SourceId,
      seq,
    });

  it('numeric ascending when values coerce to numbers', () => {
    const xs = [ent('10'), ent('2'), ent('1')];
    sortInPlaceByBodyField(xs, { key: '~v', dir: 'asc' }, ctx);
    expect(xs.map((e) => (e.fields as { v: string }).v)).toEqual([
      '1',
      '2',
      '10',
    ]);
  });

  it('string compare when non-numeric, respects desc', () => {
    const xs = [ent('apple'), ent('cherry'), ent('banana')];
    sortInPlaceByBodyField(xs, { key: '~v', dir: 'desc' }, ctx);
    expect(xs.map((e) => (e.fields as { v: string }).v)).toEqual([
      'cherry',
      'banana',
      'apple',
    ]);
  });

  it('nulls sink last in both directions', () => {
    const asc = [ent(null), ent('b'), ent('a')];
    sortInPlaceByBodyField(asc, { key: '~v', dir: 'asc' }, ctx);
    expect(asc.map((e) => (e.fields as { v?: string }).v)).toEqual([
      'a',
      'b',
      undefined,
    ]);
    const desc = [ent(null), ent('a'), ent('b')];
    sortInPlaceByBodyField(desc, { key: '~v', dir: 'desc' }, ctx);
    expect(desc.map((e) => (e.fields as { v?: string }).v)).toEqual([
      'b',
      'a',
      undefined,
    ]);
  });

  it('stable tiebreak on (sourceId, seq)', () => {
    const xs = [ent('x', 's2', 5), ent('x', 's1', 9), ent('x', 's1', 2)];
    sortInPlaceByBodyField(xs, { key: '~v', dir: 'asc' }, ctx);
    expect(xs.map((e) => `${e.sourceId}:${e.seq}`)).toEqual([
      's1:2',
      's1:9',
      's2:5',
    ]);
  });
});

describe('aggregateHistogram', () => {
  const at = (ts: number | null, level: LogLevel = 'info') =>
    makeEntry({ timestamp: ts, level });

  it('buckets entries by ts and includes empty buckets', () => {
    const res = aggregateHistogram([at(0), at(0), at(100)], 2, {
      from: 0,
      to: 100,
    });
    expect(res.range).toEqual({ from: 0, to: 100 });
    expect(res.buckets).toHaveLength(2);
    expect(res.buckets[0]!.count).toBe(2); // ts=0 → first bucket
    expect(res.buckets[1]!.count).toBe(1); // ts=100 → clamped into last
    expect(res.buckets[0]!.levelCounts).toEqual({ info: 2 });
  });

  it('derives the range from min/max ts when timeRange is open', () => {
    const res = aggregateHistogram([at(10), at(20)], 1, null);
    expect(res.range).toEqual({ from: 10, to: 20 });
  });

  it('empty when no timestamped entries', () => {
    expect(aggregateHistogram([at(null)], 4, null)).toEqual({
      buckets: [],
      range: null,
    });
  });
});
