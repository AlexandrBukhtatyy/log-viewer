import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  builtInLogicalField,
  resolveActiveLogicalFields,
} from '../../core/logical-fields/catalog.ts';
import type { LogicalField } from '../../core/types/index.ts';
import { useLogicalFields } from '../use-logical-fields.ts';

class MemoryStorage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  key(i: number): string | null {
    return [...this.store.keys()][i] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
  useLogicalFields.getState().reset();
});

afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

const customField = (id: string): LogicalField => ({
  id,
  type: 'string',
  label: id,
  origin: 'user',
  extractors: [{ type: 'field', path: id }],
});

describe('useLogicalFields — activation', () => {
  it('starts empty', () => {
    expect(useLogicalFields.getState().config).toEqual({
      activeIds: [],
      customFields: [],
    });
  });

  it('activate is idempotent', () => {
    const { activate } = useLogicalFields.getState();
    activate('trace_id');
    activate('trace_id');
    expect(useLogicalFields.getState().config.activeIds).toEqual(['trace_id']);
  });

  it('deactivate removes the id', () => {
    const { activate, deactivate } = useLogicalFields.getState();
    activate('trace_id');
    activate('user_id');
    deactivate('trace_id');
    expect(useLogicalFields.getState().config.activeIds).toEqual(['user_id']);
  });

  it('toggle flips presence', () => {
    const { toggle } = useLogicalFields.getState();
    toggle('trace_id');
    expect(useLogicalFields.getState().config.activeIds).toEqual(['trace_id']);
    toggle('trace_id');
    expect(useLogicalFields.getState().config.activeIds).toEqual([]);
  });
});

describe('useLogicalFields — custom fields', () => {
  it('addCustom activates the new field', () => {
    useLogicalFields.getState().addCustom(customField('audit_id'));
    const { config } = useLogicalFields.getState();
    expect(config.customFields).toHaveLength(1);
    expect(config.activeIds).toContain('audit_id');
  });

  it('rejects ids that collide with a built-in', () => {
    expect(() =>
      useLogicalFields.getState().addCustom(customField('trace_id')),
    ).toThrow(/collides with built-in/i);
  });

  it('rejects malformed ids', () => {
    expect(() =>
      useLogicalFields.getState().addCustom(customField('Bad Id')),
    ).toThrow(/invalid logical field id/i);
  });

  it('rejects origin other than "user"', () => {
    expect(() =>
      useLogicalFields.getState().addCustom({
        ...customField('audit_id'),
        origin: 'builtin',
      }),
    ).toThrow(/origin: "user"/);
  });

  it('rejects duplicate custom ids', () => {
    const { addCustom } = useLogicalFields.getState();
    addCustom(customField('audit_id'));
    expect(() => addCustom(customField('audit_id'))).toThrow(/already exists/i);
  });

  it('updateCustom replaces in place', () => {
    const { addCustom, updateCustom } = useLogicalFields.getState();
    addCustom(customField('audit_id'));
    const replacement: LogicalField = {
      ...customField('audit_id'),
      label: 'Audit id (renamed)',
    };
    updateCustom(replacement);
    expect(useLogicalFields.getState().config.customFields[0]?.label).toBe(
      'Audit id (renamed)',
    );
  });

  it('updateCustom throws when id is unknown', () => {
    expect(() =>
      useLogicalFields.getState().updateCustom(customField('audit_id')),
    ).toThrow(/no custom logical field/i);
  });

  it('removeCustom also drops the activation entry', () => {
    const { addCustom, removeCustom } = useLogicalFields.getState();
    addCustom(customField('audit_id'));
    removeCustom('audit_id');
    expect(useLogicalFields.getState().config).toEqual({
      activeIds: [],
      customFields: [],
    });
  });
});

describe('resolveActiveLogicalFields', () => {
  it('resolves built-in ids from the catalog', () => {
    const out = resolveActiveLogicalFields({
      activeIds: ['trace_id', 'user_id'],
      customFields: [],
    });
    expect(out.map((f) => f.id)).toEqual(['trace_id', 'user_id']);
    expect(out[0]).toBe(builtInLogicalField('trace_id'));
  });

  it('skips ids that match neither a built-in nor a custom field', () => {
    const out = resolveActiveLogicalFields({
      activeIds: ['nope'],
      customFields: [],
    });
    expect(out).toEqual([]);
  });

  it('lets a custom field override a built-in with the same id', () => {
    const override: LogicalField = {
      ...customField('trace_id'),
      // id collides intentionally — addCustom would reject it, but the
      // resolver itself must handle this combination defensively (e.g.
      // a future import path bypasses validation).
      origin: 'user',
    };
    const out = resolveActiveLogicalFields({
      activeIds: ['trace_id'],
      customFields: [override],
    });
    expect(out[0]).toBe(override);
  });

  it('preserves the order of activeIds', () => {
    const out = resolveActiveLogicalFields({
      activeIds: ['user_id', 'trace_id', 'host'],
      customFields: [],
    });
    expect(out.map((f) => f.id)).toEqual(['user_id', 'trace_id', 'host']);
  });
});
