import { describe, expect, it } from 'vitest';
import type { EntryId, SourceId } from '../types/log-entry.ts';
import type { ParseCtx } from '../types/log-parser.ts';
import { appTextParser } from './app-text-parser.ts';

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

describe('appTextParser', () => {
  it('canParse accepts bracketed-timestamp lines', () => {
    expect(
      appTextParser.canParse('[2026-05-06T14:00:00.000Z] INFO request 0'),
    ).toBe(true);
  });

  it('canParse rejects continuation lines on their own', () => {
    expect(appTextParser.canParse('  File "/app/handlers.py", line 181')).toBe(
      false,
    );
    expect(appTextParser.canParse('\tat com.example.Foo(Bar:42)')).toBe(false);
  });

  it('parses a single-line entry', () => {
    const result = appTextParser.parseLine(
      '[2026-05-06T14:00:00.000Z] INFO request 0 from dave',
      makeCtx(),
    );
    const e = result.entry!;
    expect(e.level).toBe('info');
    expect(e.message).toBe('request 0 from dave');
    expect(e.timestamp).toBe(Date.parse('2026-05-06T14:00:00.000Z'));
    expect(e.fields).toEqual({});
  });

  it('folds a Python traceback into a single entry with stack[] and exception_*', () => {
    const block = [
      '[2026-05-06T14:00:18.856Z] ERROR Traceback (most recent call last):',
      '  File "/app/handlers.py", line 181, in handle_request',
      '    result = process(payload)',
      '  File "/app/processor.py", line 59, in process',
      '    return db.execute(query)',
      'ConnectionError: upstream timeout',
    ].join('\n');
    const result = appTextParser.parseLine(block, makeCtx());
    const e = result.entry!;
    expect(e.level).toBe('error');
    expect(e.message).toBe('Traceback (most recent call last):');
    expect(Array.isArray(e.fields.stack)).toBe(true);
    expect((e.fields.stack as string[]).length).toBe(5);
    expect(e.fields.exception_type).toBe('ConnectionError');
    expect(e.fields.exception_message).toBe('upstream timeout');
  });

  it('folds a JVM stacktrace with Caused by:', () => {
    const block = [
      '[2026-05-06T14:00:19.929Z] ERROR java.lang.RuntimeException: Failed',
      '\tat com.acme.api.RequestHandler.handle(RequestHandler.java:98)',
      'Caused by: java.sql.SQLException: Connection refused',
      '\tat org.postgresql.Driver.connect(Driver.java:280)',
      '\t... 8 more',
    ].join('\n');
    const result = appTextParser.parseLine(block, makeCtx());
    const e = result.entry!;
    expect(e.level).toBe('error');
    expect((e.fields.stack as string[]).length).toBe(4);
  });

  it('exports continuationRegex for orchestrator wiring', () => {
    expect(typeof appTextParser.continuationRegex).toBe('string');
    expect(appTextParser.continuationRegex).toBeTruthy();
  });
});
