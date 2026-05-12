import { describe, expect, it } from 'vitest';
import type { EntryId, SourceId } from '../../types/log-entry.ts';
import type { ParseCtx } from '../../types/log-parser.ts';
import { defineRegexParser } from './regex-parser.ts';

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

describe('defineRegexParser', () => {
  const nginx = defineRegexParser({
    id: 'nginx-test',
    pattern:
      /^(\S+) - (\S+) \[([^\]]+)\] "(\S+) (\S+) HTTP\/\S+" (\d+) (\d+|-) "([^"]*)" "([^"]*)"$/,
    fields: [
      { group: 1, name: 'remote_addr' },
      { group: 2, name: 'remote_user' },
      { group: 4, name: 'method' },
      { group: 5, name: 'request_uri' },
      { group: 6, name: 'status', transform: 'number' },
      { group: 7, name: 'bytes_sent', transform: 'number' },
    ],
    timestampGroup: 3,
    timestampTransform: 'apache-time',
    level: { kind: 'http-status', group: 6 },
    message: (g) => `${g[4]} ${g[5]} → ${g[6]}`,
    confidence: 0.95,
  });

  it('canParse on matching line', () => {
    expect(
      nginx.canParse(
        '1.2.3.4 - - [05/May/2026:06:00:00 +0000] "GET /api HTTP/1.1" 200 1024 "-" "curl"',
      ),
    ).toBe(true);
  });

  it('canParse rejects non-matching', () => {
    expect(nginx.canParse('{"level":"info"}')).toBe(false);
    expect(nginx.canParse('plain text')).toBe(false);
  });

  it('extracts fields, message, timestamp, level', () => {
    const ctx = makeCtx();
    const result = nginx.parseLine(
      '1.2.3.4 - alice [05/May/2026:06:00:00 +0000] "GET /api HTTP/1.1" 404 512 "-" "curl"',
      ctx,
    );
    expect(result.entry).not.toBeNull();
    const e = result.entry!;
    expect(e.fields).toEqual({
      remote_addr: '1.2.3.4',
      remote_user: 'alice',
      method: 'GET',
      request_uri: '/api',
      status: 404,
      bytes_sent: 512,
    });
    expect(e.message).toBe('GET /api → 404');
    expect(e.timestamp).toBe(Date.UTC(2026, 4, 5, 6, 0, 0));
    expect(e.level).toBe('warn');
    expect(result.confidence).toBe(0.95);
  });

  it('derives error level for 5xx status', () => {
    const ctx = makeCtx();
    const result = nginx.parseLine(
      '1.2.3.4 - - [05/May/2026:06:00:00 +0000] "POST /x HTTP/1.1" 503 0 "-" "curl"',
      ctx,
    );
    expect(result.entry?.level).toBe('error');
  });

  it('returns null on parse failure', () => {
    const ctx = makeCtx();
    expect(nginx.parseLine('not a log line', ctx).entry).toBeNull();
  });
});

describe('defineRegexParser — level strategies', () => {
  it('fixed level', () => {
    const p = defineRegexParser({
      id: 't',
      pattern: /^(.+)$/,
      fields: [],
      level: { kind: 'fixed', value: 'error' },
    });
    const ctx = makeCtx();
    expect(p.parseLine('anything', ctx).entry?.level).toBe('error');
  });

  it('group-name normalisation', () => {
    const p = defineRegexParser({
      id: 't',
      pattern: /^\[(\w+)\] (.+)$/,
      fields: [{ group: 2, name: 'msg' }],
      level: { kind: 'group-name', group: 1 },
    });
    const ctx = makeCtx();
    expect(p.parseLine('[WARNING] foo', ctx).entry?.level).toBe('warn');
    expect(p.parseLine('[ERR] bar', ctx).entry?.level).toBe('error');
  });
});
