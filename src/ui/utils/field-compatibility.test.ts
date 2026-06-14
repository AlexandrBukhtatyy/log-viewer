import { describe, expect, it } from 'vitest';
import type { FieldDescriptor } from '../../core/filter/field-descriptor.ts';
import type { FieldKey } from '../../core/types/log-filter.ts';
import { compatBadgeText, compatOf } from './field-compatibility.ts';

const make = (overrides: Partial<FieldDescriptor>): FieldDescriptor => ({
  key: 'req_id' as FieldKey,
  label: 'req_id',
  type: 'string',
  origin: 'dynamic',
  ...overrides,
});

describe('compatOf', () => {
  it('returns shared for built-ins regardless of active set', () => {
    const desc = make({ origin: 'builtin', perSource: undefined });
    const c = compatOf(desc, ['s1', 's2', 's3']);
    expect(c.kind).toBe('shared');
    expect(c.presentIn).toBe(3);
    expect(c.missingSources).toEqual([]);
  });

  it('returns unique when the field lives in exactly one source', () => {
    const desc = make({
      perSource: [{ sourceId: 's1', occurrences: 500 }],
    });
    const c = compatOf(desc, ['s1', 's2']);
    expect(c.kind).toBe('unique');
    expect(c.presentIn).toBe(1);
    expect(c.total).toBe(2);
    expect(c.missingSources).toEqual(['s2']);
  });

  it('returns partial when present in some but not all sources', () => {
    const desc = make({
      perSource: [
        { sourceId: 's1', occurrences: 100 },
        { sourceId: 's2', occurrences: 50 },
      ],
    });
    const c = compatOf(desc, ['s1', 's2', 's3']);
    expect(c.kind).toBe('partial');
    expect(c.presentIn).toBe(2);
    expect(c.total).toBe(3);
    expect(c.missingSources).toEqual(['s3']);
  });

  it('returns shared when present in every active source', () => {
    const desc = make({
      perSource: [
        { sourceId: 's1', occurrences: 10 },
        { sourceId: 's2', occurrences: 20 },
      ],
    });
    const c = compatOf(desc, ['s1', 's2']);
    expect(c.kind).toBe('shared');
    expect(c.missingSources).toEqual([]);
  });

  it('treats empty activeSources as "use whatever perSource lists"', () => {
    const desc = make({
      perSource: [{ sourceId: 's1', occurrences: 1 }],
    });
    const c = compatOf(desc, []);
    expect(c.kind).toBe('shared');
    expect(c.total).toBe(1);
  });
});

describe('compatBadgeText', () => {
  it('renders nothing for shared', () => {
    expect(
      compatBadgeText(
        {
          kind: 'shared',
          presentIn: 2,
          total: 2,
          presentSources: [],
          missingSources: [],
        },
        new Map(),
      ),
    ).toBeNull();
  });

  it('renders the source name for unique', () => {
    expect(
      compatBadgeText(
        {
          kind: 'unique',
          presentIn: 1,
          total: 3,
          presentSources: ['s1'],
          missingSources: ['s2', 's3'],
        },
        new Map([['s1', 'pino.jsonl']]),
      ),
    ).toBe('pino.jsonl');
  });

  it('renders n/total for partial', () => {
    expect(
      compatBadgeText(
        {
          kind: 'partial',
          presentIn: 2,
          total: 5,
          presentSources: ['s1', 's2'],
          missingSources: ['s3', 's4', 's5'],
        },
        new Map(),
      ),
    ).toBe('2/5');
  });
});
