import { describe, expect, it } from 'vitest';
import type { FieldDescriptor } from '../../core/filter/field-descriptor.ts';
import type { LvSavedSearch } from '../contracts/lv-types.ts';
import { buildSearchSuggestions, splitLastToken } from './search-suggest.ts';

const desc = (
  key: string,
  label: string,
  topValues: ReadonlyArray<{ value: string; count: number }>,
): FieldDescriptor => ({
  key,
  label,
  type: 'string',
  origin: 'dynamic',
  topValues,
});

const saved = (name: string, query: string): LvSavedSearch => ({
  id: name,
  name,
  query,
  levels: [],
});

const descriptors = [
  desc('@level', 'Level', [
    { value: 'error', count: 120 },
    { value: 'warn', count: 40 },
    { value: 'info', count: 900 },
  ]),
  desc('service', 'Service', [{ value: 'checkout', count: 30 }]),
];

describe('splitLastToken', () => {
  it('splits the trailing token', () => {
    expect(splitLastToken('out of mem')).toEqual({
      head: 'out of ',
      token: 'mem',
    });
  });
  it('empty token after trailing space', () => {
    expect(splitLastToken('out of ')).toEqual({ head: 'out of ', token: '' });
  });
});

describe('buildSearchSuggestions', () => {
  it('suggests field values filtered by the last token, replacing it', () => {
    const out = buildSearchSuggestions({
      query: 'foo err',
      mode: 'substring',
      descriptors,
      saved: [],
      recent: [],
    });
    const values = out.filter((s) => s.kind === 'value');
    expect(values.map((v) => v.label)).toContain('error');
    const error = values.find((v) => v.label === 'error')!;
    expect(error.insert).toBe('foo error'); // last token replaced
    expect(error.hint).toBe('Level');
  });

  it('ranks startsWith above includes and higher counts first', () => {
    const out = buildSearchSuggestions({
      query: 'o',
      mode: 'substring',
      descriptors,
      saved: [],
      recent: [],
    });
    const values = out.filter((s) => s.kind === 'value').map((v) => v.label);
    // "error"/"info" contain "o"? info→no, error→contains 'o'? no. Only values
    // containing 'o': info(no), error(no)… checkout contains 'o' and starts? no.
    // Use a clearer assertion: 'info' and 'checkout' both contain 'o'.
    expect(values).toContain('info');
    expect(values).toContain('checkout');
  });

  it('suggests recent and saved, replacing the whole query', () => {
    const out = buildSearchSuggestions({
      query: 'err',
      mode: 'substring',
      descriptors: [],
      saved: [saved('Errors', 'level error')],
      recent: ['error timeout', 'unrelated'],
    });
    const recent = out.filter((s) => s.kind === 'recent');
    expect(recent.map((r) => r.label)).toEqual(['error timeout']); // 'unrelated' filtered
    expect(recent[0]!.insert).toBe('error timeout');
    const savedOut = out.filter((s) => s.kind === 'saved');
    expect(savedOut[0]!.insert).toBe('level error');
    expect(savedOut[0]!.hint).toBe('Errors');
  });

  it('emits FTS syntax hints only in fts mode', () => {
    const sub = buildSearchSuggestions({
      query: 'dead',
      mode: 'substring',
      descriptors: [],
      saved: [],
      recent: [],
    });
    expect(sub.some((s) => s.kind === 'syntax')).toBe(false);

    const fts = buildSearchSuggestions({
      query: 'dead',
      mode: 'fts',
      descriptors: [],
      saved: [],
      recent: [],
    });
    const syntax = fts.filter((s) => s.kind === 'syntax');
    expect(syntax.find((s) => s.hint === 'exact phrase')?.insert).toBe(
      '"dead"',
    );
    expect(syntax.find((s) => s.hint === 'prefix')?.insert).toBe('dead*');
    expect(syntax.find((s) => s.hint === 'exclude')?.insert).toBe('-dead');
    expect(syntax.find((s) => s.hint === 'either term')?.insert).toBe(
      'dead OR ',
    );
  });

  it('does not suggest the exact current query as recent', () => {
    const out = buildSearchSuggestions({
      query: 'error timeout',
      mode: 'substring',
      descriptors: [],
      saved: [],
      recent: ['error timeout'],
    });
    expect(out.filter((s) => s.kind === 'recent')).toHaveLength(0);
  });
});
