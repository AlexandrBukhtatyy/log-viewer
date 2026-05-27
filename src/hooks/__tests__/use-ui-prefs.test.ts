import { describe, expect, it } from 'vitest';
import { migrateUiPrefs, type LvTweaks } from '../use-ui-prefs.ts';

describe('migrateUiPrefs', () => {
  it('returns the input untouched when persisted is null', () => {
    expect(migrateUiPrefs(null, 0)).toBeNull();
    expect(migrateUiPrefs(undefined, 0)).toBeUndefined();
  });

  it('fills timelineOn=false during v0 → v1', () => {
    const out = migrateUiPrefs({ theme: 'dark' }, 0) as Partial<LvTweaks>;
    expect(out.timelineOn).toBe(false);
  });

  it('seeds presets from non-empty columns during v1 → v2', () => {
    const out = migrateUiPrefs(
      {
        columns: [
          { key: 'method', widthPx: 80 },
          { key: 'status', widthPx: 60 },
        ],
        presets: [],
      },
      1,
    ) as Partial<LvTweaks>;
    expect(out.presets).toHaveLength(1);
    expect(out.presets?.[0]).toMatchObject({
      id: 'user:legacy',
      name: 'My columns',
      origin: 'user',
    });
    expect(out.presets?.[0].columns).toEqual([
      { key: 'method', widthPx: 80 },
      { key: 'status', widthPx: 60 },
    ]);
    // Global `columns` stays put — the migration also seeds it as a
    // preset so the user can re-apply on per-tab views.
    expect(out.columns).toEqual([
      { key: 'method', widthPx: 80 },
      { key: 'status', widthPx: 60 },
    ]);
  });

  it('leaves presets alone when migration v1 → v2 sees them already present', () => {
    const existing = [
      {
        id: 'user:abc',
        name: 'Existing',
        columns: [{ key: 'foo', widthPx: 60 }],
        origin: 'user' as const,
      },
    ];
    const out = migrateUiPrefs(
      { columns: [{ key: 'status', widthPx: 60 }], presets: existing },
      1,
    ) as Partial<LvTweaks>;
    expect(out.presets).toEqual(existing);
  });

  it('produces empty presets when no global columns exist', () => {
    const out = migrateUiPrefs({ columns: [] }, 1) as Partial<LvTweaks>;
    expect(out.presets).toEqual([]);
  });

  it('compound v0 → v2 migration applies both steps', () => {
    const out = migrateUiPrefs(
      { columns: [{ key: 'status', widthPx: 60 }] },
      0,
    ) as Partial<LvTweaks>;
    expect(out.timelineOn).toBe(false);
    expect(out.presets?.[0]?.name).toBe('My columns');
  });
});
