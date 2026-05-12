import { describe, expect, it } from 'vitest';
import { compileGrok } from './grok.ts';

describe('compileGrok', () => {
  it('compiles a single named token', () => {
    const { pattern, bindings } = compileGrok('%{IP:client}');
    expect(bindings).toEqual([{ name: 'client', group: 1, transform: 'as-is' }]);
    expect(pattern.exec('192.168.1.1')?.[1]).toBe('192.168.1.1');
  });

  it('treats anonymous tokens as non-capturing', () => {
    const { bindings } = compileGrok('%{WORD} %{NUMBER:n}');
    expect(bindings.map((b) => b.name)).toEqual(['n']);
    expect(bindings[0].group).toBe(1);
  });

  it('infers number transform for numeric tokens', () => {
    const { bindings } = compileGrok('%{NUMBER:size}');
    expect(bindings[0].transform).toBe('number');
  });

  it('honours explicit :int / :float type suffix', () => {
    const { bindings } = compileGrok('%{WORD:method} %{NUMBER:size:int}');
    const m = new Map(bindings.map((b) => [b.name, b]));
    expect(m.get('method')?.transform).toBe('as-is');
    expect(m.get('size')?.transform).toBe('number');
  });

  it('expands nested tokens without adding outer groups', () => {
    const { pattern, bindings } = compileGrok('%{IPORHOST:host}');
    // Only one user binding even though IPORHOST contains IP+HOSTNAME.
    expect(bindings).toHaveLength(1);
    expect(pattern.exec('example.com')?.[1]).toBe('example.com');
    expect(pattern.exec('10.0.0.1')?.[1]).toBe('10.0.0.1');
  });

  it('matches an nginx-combined-style line via grok', () => {
    const grok =
      '%{IPORHOST:client} - %{USER:user} \\[%{HTTPDATE:ts}\\] ' +
      '"%{WORD:method} %{URIPATHPARAM:uri} HTTP/%{NUMBER:http_version}" ' +
      '%{NUMBER:status:int} %{NUMBER:bytes:int} ' +
      '"%{NOTSPACE:referer}" %{QUOTEDSTRING:agent}';
    const { pattern, bindings } = compileGrok(grok);
    const line =
      '10.0.0.1 - alice [10/Oct/2025:13:55:36 +0000] "GET /index HTTP/1.1" 200 1234 ' +
      '"-" "Mozilla/5.0"';
    const m = pattern.exec(line);
    expect(m).not.toBeNull();
    const byName = new Map(bindings.map((b) => [b.name, m![b.group]]));
    expect(byName.get('client')).toBe('10.0.0.1');
    expect(byName.get('method')).toBe('GET');
    expect(byName.get('status')).toBe('200');
    expect(byName.get('uri')).toBe('/index');
  });

  it('throws on unknown tokens', () => {
    expect(() => compileGrok('%{TOTALLY_FAKE_TOKEN:x}')).toThrowError(
      /unknown token 'TOTALLY_FAKE_TOKEN'/,
    );
  });

  it('throws on cyclic custom tokens', () => {
    expect(() =>
      compileGrok('%{A:x}', { A: '%{B}', B: '%{A}' }),
    ).toThrowError(/cyclic reference/);
  });

  it('accepts user-defined custom tokens that reference built-ins', () => {
    const { pattern, bindings } = compileGrok('%{MYID:id}', {
      MYID: '[A-Z]{3}-%{NUMBER}',
    });
    expect(bindings).toEqual([{ name: 'id', group: 1, transform: 'as-is' }]);
    expect(pattern.exec('ABC-1234')?.[1]).toBe('ABC-1234');
  });
});
