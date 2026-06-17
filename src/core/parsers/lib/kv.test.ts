import { describe, expect, it } from 'vitest';
import { extractKeyValues, extractLeadingTag } from './kv.ts';

describe('extractLeadingTag', () => {
  it('pulls a leading [tag] and returns the remainder', () => {
    expect(extractLeadingTag('[search] user logged in')).toEqual({
      tag: 'search',
      rest: 'user logged in',
    });
  });

  it('trims the tag and tolerates extra spacing', () => {
    expect(extractLeadingTag('[ api-gateway ]   job done')).toEqual({
      tag: 'api-gateway',
      rest: 'job done',
    });
  });

  it('returns null when there is no leading bracket', () => {
    expect(extractLeadingTag('user logged in [search]')).toBeNull();
    expect(extractLeadingTag('plain message')).toBeNull();
  });
});

describe('extractKeyValues', () => {
  it('extracts k=v pairs', () => {
    expect(extractKeyValues('user logged in reqId=req_1 latency=32')).toEqual({
      reqId: 'req_1',
      latency: 32,
    });
  });

  it('coerces only purely-numeric values to number', () => {
    const out = extractKeyValues('a=10 b=10.5 c=-3 d=10ms e=req_1');
    expect(out).toEqual({ a: 10, b: 10.5, c: -3, d: '10ms', e: 'req_1' });
  });

  it('unwraps double-quoted values', () => {
    expect(extractKeyValues('msg="hello world" code=500')).toEqual({
      msg: 'hello world',
      code: 500,
    });
  });

  it('supports dotted keys and last-wins on duplicates', () => {
    expect(extractKeyValues('http.status=200 http.status=404')).toEqual({
      'http.status': 404,
    });
  });

  it('returns an empty object when there are no pairs', () => {
    expect(extractKeyValues('just a plain message')).toEqual({});
  });
});
