import type { FieldKey } from '../types/log-filter.ts';

/**
 * Display kind hint for the picker UI (column / group-by / filter).
 *
 * Mirrors the `field_meta.type` enum stored in SQLite for dynamic
 * fields, plus three semantic flavors built-in attributes can take
 * (`time`/`level`/`enum`) so the UI can pick the right widget.
 */
export type FieldDescriptorType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'time'
  | 'level'
  | 'enum'
  | 'mixed';

export interface FieldTopValue {
  readonly value: string;
  readonly count: number;
}

export interface FieldDescriptor {
  readonly key: FieldKey;
  readonly label: string;
  readonly type: FieldDescriptorType;
  readonly origin: 'builtin' | 'dynamic';
  /** Occurrences across the requested source set; absent for builtins. */
  readonly occurrences?: number;
  /** occurrences / total_seen; absent for builtins or when total_seen=0. */
  readonly presenceRate?: number;
  readonly topValues?: ReadonlyArray<FieldTopValue>;
}

/**
 * Static descriptors for the `@`-namespace built-ins. Order matters: it's
 * the order the picker shows them in. `@ts`/`@level`/`@file`/`@source.*`
 * lead the list because those are the attributes users reach for first
 * when laying out columns or grouping.
 */
export const BUILT_IN_FIELD_DESCRIPTORS: ReadonlyArray<FieldDescriptor> = [
  { key: '@ts',          label: 'Time',         type: 'time',   origin: 'builtin' },
  { key: '@level',       label: 'Level',        type: 'level',  origin: 'builtin' },
  { key: '@file',        label: 'File',         type: 'string', origin: 'builtin' },
  { key: '@source.name', label: 'Source name',  type: 'string', origin: 'builtin' },
  { key: '@source.kind', label: 'Source kind',  type: 'enum',   origin: 'builtin' },
  { key: '@source.id',   label: 'Source id',    type: 'string', origin: 'builtin' },
  { key: '@seq',         label: 'Sequence',     type: 'number', origin: 'builtin' },
  { key: '@byte_start',  label: 'Byte start',   type: 'number', origin: 'builtin' },
  { key: '@byte_end',    label: 'Byte end',     type: 'number', origin: 'builtin' },
];
