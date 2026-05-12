import { describe, expect, it } from 'vitest';
import type { EntryId, SourceId } from '../types/log-entry.ts';
import type { ParseCtx } from '../types/log-parser.ts';
import { nginxCombinedParser } from './nginx-combined-parser.ts';

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

const SAMPLE =
  '28.178.205.112 - alice [05/May/2026:06:00:00 +0000] ' +
  '"PUT /api/v1/auth/login HTTP/1.1" 401 23017 "-" "curl/8.4.0"';

describe('nginxCombinedParser', () => {
  it('canParse matches combined log format', () => {
    expect(nginxCombinedParser.canParse(SAMPLE)).toBe(true);
  });

  it('canParse rejects non-matching lines', () => {
    expect(nginxCombinedParser.canParse('{"level":"info"}')).toBe(false);
    expect(nginxCombinedParser.canParse('plain text')).toBe(false);
    expect(nginxCombinedParser.canParse('[2026] INFO msg')).toBe(false);
  });

  it('extracts standard combined fields', () => {
    const result = nginxCombinedParser.parseLine(SAMPLE, makeCtx());
    const e = result.entry!;
    expect(e.fields).toMatchObject({
      remote_addr: '28.178.205.112',
      remote_user: 'alice',
      method: 'PUT',
      request_uri: '/api/v1/auth/login',
      http_version: '1.1',
      status: 401,
      bytes_sent: 23017,
      user_agent: 'curl/8.4.0',
    });
    expect(e.timestamp).toBe(Date.UTC(2026, 4, 5, 6, 0, 0));
  });

  it('derives warn level for 4xx', () => {
    const result = nginxCombinedParser.parseLine(SAMPLE, makeCtx());
    expect(result.entry?.level).toBe('warn');
  });

  it('derives error level for 5xx', () => {
    const line = SAMPLE.replace('401 23017', '503 0');
    const result = nginxCombinedParser.parseLine(line, makeCtx());
    expect(result.entry?.level).toBe('error');
  });

  it('builds compact message', () => {
    const result = nginxCombinedParser.parseLine(SAMPLE, makeCtx());
    expect(result.entry?.message).toBe('PUT /api/v1/auth/login → 401');
  });

  it('exports defaultColumns', () => {
    expect(nginxCombinedParser.defaultColumns).toEqual([
      'method',
      'status',
      'request_uri',
    ]);
  });
});
