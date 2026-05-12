import { describe, expect, it } from 'vitest';
import {
  compileCustomParser,
  type CustomParserDef,
} from './custom-parser-def.ts';
import type { EntryId, SourceId } from '../types/log-entry.ts';
import type { ParseCtx } from '../types/log-parser.ts';

const makeCtx = (sourceId = 'src-1'): ParseCtx => {
  let seq = 0;
  let nextEntry = 0;
  return {
    sourceId: sourceId as SourceId,
    nextId: () => `e-${++nextEntry}` as EntryId,
    nextSeq: () => seq++,
    now: () => 0,
  };
};

const baseDef: CustomParserDef = {
  id: 'test',
  label: 'Test',
  kind: 'regex',
  pattern: '',
  flags: '',
  fields: [],
  version: 1,
  createdAt: 0,
  updatedAt: 0,
};

describe('compileCustomParser — regex kind', () => {
  it('parses a basic line with named fields', () => {
    const parser = compileCustomParser({
      ...baseDef,
      kind: 'regex',
      pattern: '^\\[(\\w+)\\] (.+)$',
      fields: [
        { group: 1, name: 'service' },
        { group: 2, name: 'msg' },
      ],
    });
    expect(parser).not.toBeNull();
    const res = parser!.parseLine('[auth] login ok', makeCtx());
    expect(res.entry?.fields).toMatchObject({ service: 'auth', msg: 'login ok' });
  });

  it('returns null on invalid regex', () => {
    const parser = compileCustomParser({
      ...baseDef,
      kind: 'regex',
      pattern: '([unclosed',
    });
    expect(parser).toBeNull();
  });
});

describe('compileCustomParser — grok kind', () => {
  it('compiles a grok pattern with named captures and number coercion', () => {
    const parser = compileCustomParser({
      ...baseDef,
      kind: 'grok',
      pattern: '%{IP:client} %{NUMBER:status:int}',
      timestampField: undefined,
    });
    expect(parser).not.toBeNull();
    const res = parser!.parseLine('10.0.0.1 200', makeCtx());
    expect(res.entry?.fields).toMatchObject({ client: '10.0.0.1', status: 200 });
  });

  it('resolves timestampField name → numeric ts', () => {
    const parser = compileCustomParser({
      ...baseDef,
      kind: 'grok',
      pattern: '%{TIMESTAMP_ISO8601:@ts} %{GREEDYDATA:msg}',
      timestampField: '@ts',
      timestampTransform: 'iso-time',
    });
    expect(parser).not.toBeNull();
    const res = parser!.parseLine('2025-01-01T00:00:00Z hello', makeCtx());
    expect(typeof res.entry?.timestamp).toBe('number');
  });

  it('returns null on invalid grok', () => {
    const parser = compileCustomParser({
      ...baseDef,
      kind: 'grok',
      pattern: '%{UNKNOWN_THING}',
    });
    expect(parser).toBeNull();
  });
});

describe('compileCustomParser — js-function kind', () => {
  it('runs the user function and lifts fields/level/timestamp', () => {
    const parser = compileCustomParser({
      ...baseDef,
      kind: 'js-function',
      pattern: `
        const m = line.match(/^(\\d+) (\\w+) (.+)$/);
        if (!m) return null;
        return {
          timestamp: Number(m[1]),
          level: m[2],
          message: m[3],
          fields: { code: Number(m[1]) },
        };
      `,
    });
    expect(parser).not.toBeNull();
    const res = parser!.parseLine('123 warn boom', makeCtx());
    expect(res.entry?.level).toBe('warn');
    expect(res.entry?.message).toBe('boom');
    expect(res.entry?.timestamp).toBe(123);
    expect(res.entry?.fields).toMatchObject({ code: 123 });
  });

  it('swallows thrown errors and yields null entry', () => {
    const parser = compileCustomParser({
      ...baseDef,
      kind: 'js-function',
      pattern: 'throw new Error("boom");',
    });
    expect(parser).not.toBeNull();
    const res = parser!.parseLine('anything', makeCtx());
    expect(res.entry).toBeNull();
  });

  it('returns null parser on syntax error in the function body', () => {
    const parser = compileCustomParser({
      ...baseDef,
      kind: 'js-function',
      pattern: 'function(){ // missing body',
    });
    expect(parser).toBeNull();
  });
});
