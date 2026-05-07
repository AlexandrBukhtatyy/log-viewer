import { describe, expect, it } from 'vitest';
import { HandleCache } from '../handle-cache.ts';

const fakeHandle = (name: string): FileSystemFileHandle =>
  ({ kind: 'file', name }) as unknown as FileSystemFileHandle;

describe('HandleCache', () => {
  it('returns null when key is absent', () => {
    const c = new HandleCache();
    expect(c.get('s1', 'a.log')).toBeNull();
  });

  it('round-trips a stored handle', () => {
    const c = new HandleCache();
    const h = fakeHandle('a.log');
    c.set('s1', 'a.log', h);
    expect(c.get('s1', 'a.log')).toBe(h);
  });

  it('isolates entries by sourceId and filePath', () => {
    const c = new HandleCache();
    const h1 = fakeHandle('a');
    const h2 = fakeHandle('b');
    c.set('s1', 'a.log', h1);
    c.set('s2', 'a.log', h2);
    expect(c.get('s1', 'a.log')).toBe(h1);
    expect(c.get('s2', 'a.log')).toBe(h2);
    expect(c.get('s1', 'b.log')).toBeNull();
  });

  it('invalidate(sourceId) drops only that source', () => {
    const c = new HandleCache();
    c.set('s1', 'a.log', fakeHandle('a'));
    c.set('s1', 'b.log', fakeHandle('b'));
    c.set('s2', 'a.log', fakeHandle('a2'));
    c.invalidate('s1');
    expect(c.get('s1', 'a.log')).toBeNull();
    expect(c.get('s1', 'b.log')).toBeNull();
    expect(c.get('s2', 'a.log')).not.toBeNull();
  });

  it('clear() empties the cache', () => {
    const c = new HandleCache();
    c.set('s1', 'a.log', fakeHandle('a'));
    c.clear();
    expect(c.get('s1', 'a.log')).toBeNull();
  });
});
