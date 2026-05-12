import { describe, expect, it } from 'vitest';
import type { EntryId, SourceId } from '../types/log-entry.ts';
import type { ParseCtx } from '../types/log-parser.ts';
import { syslog3164Parser } from './syslog-parser.ts';

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

describe('syslog3164Parser', () => {
  it('canParse — accepts BSD-style with PID', () => {
    expect(
      syslog3164Parser.canParse(
        'May  5 06:00:00 myhost sshd[1234]: Accepted publickey for alice',
      ),
    ).toBe(true);
  });

  it('canParse — accepts priority byte form', () => {
    expect(
      syslog3164Parser.canParse(
        '<34>Oct 11 22:14:15 mymachine su: failed for lonvick',
      ),
    ).toBe(true);
  });

  it('canParse — rejects non-syslog', () => {
    expect(syslog3164Parser.canParse('{"level":"info"}')).toBe(false);
    expect(syslog3164Parser.canParse('plain text')).toBe(false);
  });

  it('extracts hostname / program / pid / message', () => {
    const result = syslog3164Parser.parseLine(
      'May  5 06:00:00 myhost sshd[1234]: Accepted publickey for alice',
      makeCtx(),
    );
    const e = result.entry!;
    expect(e.fields.hostname).toBe('myhost');
    expect(e.fields.program).toBe('sshd');
    expect(e.fields.pid).toBe(1234);
    expect(e.fields.syslog_message).toBe('Accepted publickey for alice');
    expect(e.message).toBe('Accepted publickey for alice');
  });

  it('derives level from <priority> byte', () => {
    // priority 34 = facility 4 * 8 + severity 2 (error)
    const result = syslog3164Parser.parseLine(
      '<34>May  5 06:00:00 myhost su: failed for root',
      makeCtx(),
    );
    expect(result.entry?.level).toBe('error');
  });

  it('omits pid when absent', () => {
    const result = syslog3164Parser.parseLine(
      'May  5 06:00:00 myhost cron: routine cleanup',
      makeCtx(),
    );
    expect(result.entry?.fields.pid).toBeUndefined();
    expect(result.entry?.fields.program).toBe('cron');
  });
});
