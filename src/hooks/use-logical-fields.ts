import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { builtInLogicalField } from '../core/logical-fields/catalog.ts';
import {
  EMPTY_LOGICAL_FIELDS_CONFIG,
  isValidLogicalFieldId,
  type LogicalField,
  type LogicalFieldsConfig,
} from '../core/types/index.ts';

/**
 * Workspace-wide store of activated logical fields and user-defined
 * custom ones (ADR-0030). Built-in templates ship disabled — only ids
 * present in `config.activeIds` are exposed to pickers and the worker.
 *
 * Persistence is via the same `lv:`-prefixed localStorage pattern as
 * `use-saved-searches` / `use-bookmarks`. JSON-serializable shape, no
 * regex objects or callbacks live here.
 */
export interface LogicalFieldsState {
  readonly config: LogicalFieldsConfig;
  /** Add an id to the active set (idempotent). */
  activate(id: string): void;
  /** Remove an id from the active set. */
  deactivate(id: string): void;
  /** Flip activation for the given id. */
  toggle(id: string): void;
  /**
   * Register a user-defined custom field and activate it. Rejects when
   * the id is malformed, collides with a built-in, or duplicates an
   * existing custom one.
   */
  addCustom(field: LogicalField): void;
  /** Replace a custom field's definition in place (matched by id). */
  updateCustom(field: LogicalField): void;
  /** Drop a custom field and its activation entry. */
  removeCustom(id: string): void;
  /** Wipe everything — for clear-app-data flows and tests. */
  reset(): void;
  /**
   * Replace the entire config (active ids + custom fields) in one
   * shot. Used by import flows; the caller is responsible for
   * parsing/validating the JSON shape before invoking.
   */
  replaceConfig(next: LogicalFieldsConfig): void;
}

const addUnique = (arr: ReadonlyArray<string>, id: string): string[] =>
  arr.includes(id) ? arr.slice() : [...arr, id];

export const useLogicalFields = create<LogicalFieldsState>()(
  persist(
    (set, get) => ({
      config: EMPTY_LOGICAL_FIELDS_CONFIG,
      activate: (id) => {
        const { config } = get();
        if (config.activeIds.includes(id)) return;
        set({
          config: { ...config, activeIds: [...config.activeIds, id] },
        });
      },
      deactivate: (id) => {
        const { config } = get();
        if (!config.activeIds.includes(id)) return;
        set({
          config: {
            ...config,
            activeIds: config.activeIds.filter((x) => x !== id),
          },
        });
      },
      toggle: (id) => {
        const { config } = get();
        const next = config.activeIds.includes(id)
          ? config.activeIds.filter((x) => x !== id)
          : [...config.activeIds, id];
        set({ config: { ...config, activeIds: next } });
      },
      addCustom: (field) => {
        if (field.origin !== 'user') {
          throw new Error('custom logical field must have origin: "user"');
        }
        if (!isValidLogicalFieldId(field.id)) {
          throw new Error(`invalid logical field id: ${field.id}`);
        }
        if (builtInLogicalField(field.id) !== null) {
          throw new Error(
            `id collides with built-in logical field: ${field.id}`,
          );
        }
        const { config } = get();
        if (config.customFields.some((f) => f.id === field.id)) {
          throw new Error(`custom logical field already exists: ${field.id}`);
        }
        set({
          config: {
            activeIds: addUnique(config.activeIds, field.id),
            customFields: [...config.customFields, field],
          },
        });
      },
      updateCustom: (field) => {
        const { config } = get();
        const idx = config.customFields.findIndex((f) => f.id === field.id);
        if (idx === -1) {
          throw new Error(`no custom logical field with id: ${field.id}`);
        }
        const next = config.customFields.slice();
        next[idx] = field;
        set({ config: { ...config, customFields: next } });
      },
      removeCustom: (id) => {
        const { config } = get();
        set({
          config: {
            activeIds: config.activeIds.filter((x) => x !== id),
            customFields: config.customFields.filter((f) => f.id !== id),
          },
        });
      },
      reset: () => set({ config: EMPTY_LOGICAL_FIELDS_CONFIG }),
      replaceConfig: (next) => set({ config: next }),
    }),
    {
      name: 'lv:logical-fields',
      version: 1,
    },
  ),
);
