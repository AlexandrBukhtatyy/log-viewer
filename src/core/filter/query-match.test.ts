import { describe, expect, it } from 'vitest';
import type { LogFilter } from '../types/index.ts';
import { compileFreeTextQuery } from './query-match.ts';

const baseFilter: LogFilter = {
  levels: null,
  query: '',
  queryMode: 'substring',
  caseSensitive: false,
  wholeWord: false,
  timeRange: null,
  sources: null,
  services: null,
  filePaths: null,
};

const fts = (
  query: string,
  over: Partial<LogFilter> = {},
): ((text: string) => boolean) => {
  const compiled = compileFreeTextQuery({
    ...baseFilter,
    queryMode: 'fts',
    query,
    ...over,
  });
  if (compiled === null) throw new Error('expected a compiled query');
  return compiled.test;
};

describe('compileFreeTextQuery — fts mode', () => {
  it('returns null for an empty query', () => {
    expect(
      compileFreeTextQuery({ ...baseFilter, queryMode: 'fts' }),
    ).toBeNull();
  });

  it('implicit AND between terms', () => {
    const m = fts('out of memory');
    expect(m('process ran out of memory and died')).toBe(true);
    expect(m('out of disk')).toBe(false); // missing "memory"
    expect(m('memory is out of bounds')).toBe(true); // order does not matter for AND
    expect(m('memory out')).toBe(false); // missing "of"
  });

  it('is case-insensitive by default, case-sensitive when asked', () => {
    expect(fts('Error')('an error happened')).toBe(true);
    expect(fts('Error', { caseSensitive: true })('an error happened')).toBe(
      false,
    );
    expect(fts('Error', { caseSensitive: true })('an Error happened')).toBe(
      true,
    );
  });

  it('matches whole tokens, not substrings', () => {
    const m = fts('time');
    expect(m('request time exceeded')).toBe(true);
    expect(m('timeout reached')).toBe(false); // "time" is not a token of "timeout"
  });

  it('quoted phrase requires contiguous tokens', () => {
    const m = fts('"out of memory"');
    expect(m('fatal: out of memory now')).toBe(true);
    expect(m('out of the memory pool')).toBe(false); // not contiguous
    expect(m('memory out of bounds')).toBe(false);
  });

  it('OR has lower precedence than implicit AND', () => {
    const m = fts('error timeout OR warn');
    expect(m('connection timeout error')).toBe(true); // error AND timeout
    expect(m('just a warn line')).toBe(true); // warn
    expect(m('only an error')).toBe(false); // error but no timeout, no warn
  });

  it('negation with - and NOT excludes', () => {
    expect(fts('error -debug')('error in prod')).toBe(true);
    expect(fts('error -debug')('error debug trace')).toBe(false);
    expect(fts('error NOT debug')('error debug trace')).toBe(false);
    expect(fts('error NOT debug')('error info trace')).toBe(true);
  });

  it('prefix term matches tokens starting with the stem', () => {
    const m = fts('time*');
    expect(m('timeout reached')).toBe(true);
    expect(m('timer fired')).toBe(true);
    expect(m('runtime error')).toBe(false); // token is "runtime", not "time…"
  });

  it('only-operators query matches nothing', () => {
    const compiled = compileFreeTextQuery({
      ...baseFilter,
      queryMode: 'fts',
      query: 'OR NOT',
    });
    expect(compiled).not.toBeNull();
    expect(compiled?.test('anything at all')).toBe(false);
  });
});

describe('compileFreeTextQuery — substring/regex unchanged', () => {
  it('substring still matches as a raw substring', () => {
    const c = compileFreeTextQuery({ ...baseFilter, query: 'timeo' });
    expect(c?.test('timeout reached')).toBe(true);
  });

  it('regex compiles and matches', () => {
    const c = compileFreeTextQuery({
      ...baseFilter,
      queryMode: 'regex',
      query: '\\bdead\\w+\\b',
    });
    expect(c?.test('a deadlock occurred')).toBe(true);
    expect(c?.test('nothing here')).toBe(false);
  });
});
