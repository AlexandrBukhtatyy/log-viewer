import { describe, expect, it } from 'vitest';
import type { LvColumnPref } from '../../hooks/use-ui-prefs.ts';
import type { LvTab } from '../contracts/lv-types.ts';
import { resolveActiveColumns } from './active-columns.ts';

const col = (key: string, widthPx = 140): LvColumnPref => ({ key, widthPx });

const tab = (id: string, columns?: ReadonlyArray<LvColumnPref>): LvTab => ({
  id,
  name: id,
  kind: 'app',
  ...(columns ? { columns } : {}),
});

describe('resolveActiveColumns', () => {
  it('returns the global columns for the __all__ tab', () => {
    const global = [col('@level'), col('msg')];
    expect(resolveActiveColumns('__all__', [tab('src1', [col('status')])], global)).toBe(
      global,
    );
  });

  it('returns tab.columns when the active tab has them', () => {
    const global = [col('@level')];
    const tabs = [tab('nginx', [col('method'), col('status'), col('request_uri')])];
    expect(resolveActiveColumns('nginx', tabs, global)).toEqual([
      col('method'),
      col('status'),
      col('request_uri'),
    ]);
  });

  it('falls back to the global columns when tab.columns is absent', () => {
    const global = [col('@level')];
    const tabs = [tab('plain-text-file')]; // no columns field
    expect(resolveActiveColumns('plain-text-file', tabs, global)).toBe(global);
  });

  it('falls back when the activeTabId is unknown (no matching tab)', () => {
    const global = [col('@level')];
    expect(resolveActiveColumns('ghost', [tab('other', [col('x')])], global)).toBe(
      global,
    );
  });

  it('returns an empty array when tab.columns is explicitly empty', () => {
    // Empty columns is a meaningful choice (user cleared the picker on this
    // tab). It must NOT fall back to the global set — that would silently
    // re-introduce columns the user deleted.
    const global = [col('@level')];
    const tabs = [tab('cleared', [])];
    expect(resolveActiveColumns('cleared', tabs, global)).toEqual([]);
  });
});
