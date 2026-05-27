import { describe, expect, it } from 'vitest';
import type { EntryId, LogEntry, SourceId } from '../../core/types/index.ts';
import type { LvVirtualField } from '../contracts/lv-types.ts';
import {
  compileVirtualFields,
  isVirtualFieldKey,
  resolveVirtualField,
  VF_KEY_PREFIX,
} from './virtual-fields.ts';

const entry = (raw: string, message = raw): LogEntry => ({
  id: 'e1' as EntryId,
  sourceId: 's1' as SourceId,
  seq: 1,
  timestamp: 0,
  level: 'info',
  message,
  raw,
  fields: {},
  filePath: '',
  byteStart: 0,
  byteEnd: raw.length,
  lineNumber: 1,
  fileSeq: 1,
});

describe('isVirtualFieldKey', () => {
  it('matches keys with vf: prefix', () => {
    expect(isVirtualFieldKey('vf:status')).toBe(true);
    expect(isVirtualFieldKey('vf:')).toBe(true);
  });
  it('rejects other keys', () => {
    expect(isVirtualFieldKey('@level')).toBe(false);
    expect(isVirtualFieldKey('status')).toBe(false);
    expect(isVirtualFieldKey('vfield')).toBe(false);
  });
});

describe('compileVirtualFields', () => {
  it('compiles a valid regex into the map under the virtual key', () => {
    const defs: ReadonlyArray<LvVirtualField> = [
      {
        key: `${VF_KEY_PREFIX}status`,
        pattern: '\\bstatus=(?<status>\\d+)',
        group: 'status',
      },
    ];
    const map = compileVirtualFields(defs);
    expect(map.size).toBe(1);
    expect(map.get(`${VF_KEY_PREFIX}status`)?.group).toBe('status');
    expect(map.get(`${VF_KEY_PREFIX}status`)?.target).toBe('raw');
  });
  it('skips entries with invalid regex patterns', () => {
    const defs: ReadonlyArray<LvVirtualField> = [
      { key: 'vf:bad', pattern: '(?<g>', group: 'g' },
      { key: 'vf:ok', pattern: '(?<ok>\\d+)', group: 'ok' },
    ];
    const map = compileVirtualFields(defs);
    expect(map.has('vf:bad')).toBe(false);
    expect(map.has('vf:ok')).toBe(true);
  });
  it('preserves the explicit target override', () => {
    const map = compileVirtualFields([
      { key: 'vf:m', pattern: '(?<m>\\w+)', group: 'm', target: 'message' },
    ]);
    expect(map.get('vf:m')?.target).toBe('message');
  });
});

describe('resolveVirtualField', () => {
  const map = compileVirtualFields([
    {
      key: 'vf:status',
      pattern: '\\bstatus=(?<status>\\d+)',
      group: 'status',
    },
    {
      key: 'vf:msg_word',
      pattern: '(?<word>\\w+)',
      group: 'word',
      target: 'message',
    },
  ]);

  it('returns the named group value when the regex matches raw', () => {
    expect(
      resolveVirtualField(entry('request done status=404 path=/x'), 'vf:status', map),
    ).toBe('404');
  });

  it('returns null when the regex does not match', () => {
    expect(
      resolveVirtualField(entry('no status here'), 'vf:status', map),
    ).toBeNull();
  });

  it('returns null when the key is not in the compiled map', () => {
    expect(resolveVirtualField(entry('anything'), 'vf:ghost', map)).toBeNull();
  });

  it("reads from entry.message when target is 'message'", () => {
    const e = entry('raw text', 'hello world');
    expect(resolveVirtualField(e, 'vf:msg_word', map)).toBe('hello');
  });

  it('returns null when the named group is absent from the match', () => {
    // Regex matches but the named group never participated.
    const m = compileVirtualFields([
      { key: 'vf:phantom', pattern: '\\d+(?<g>x)?', group: 'g' },
    ]);
    expect(resolveVirtualField(entry('abc 123 xyz'), 'vf:phantom', m)).toBeNull();
  });
});
