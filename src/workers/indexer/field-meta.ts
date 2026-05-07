import type { LogEntry, SourceId } from '../../core/types/index.ts';

/**
 * Per-source / per-key schema cache helpers (ADR-0017 §field_meta).
 *
 * Pure JS — no SQL — so the merge logic stays unit-testable. The indexer
 * orchestrates the read-existing → merge → UPSERT cycle; this module owns
 * the merge step.
 */

export type FieldType = 'string' | 'number' | 'boolean' | 'mixed';

export interface TopValueEntry {
  readonly value: string;
  readonly count: number;
}

export interface FieldMetaAccum {
  occurrences: number;
  /** Concrete types observed in this batch — `mixed` is computed at merge. */
  types: Set<Exclude<FieldType, 'mixed'>>;
  topVals: Map<string, number>;
}

export const FIELD_META_TOP_K = 20;
/** Reject very long field values from the top-K cache — they're rarely
 *  useful for filter dropdowns and would bloat the JSON blob. */
export const FIELD_META_VALUE_MAX_CHARS = 200;

export const inferFieldType = (
  v: unknown,
): Exclude<FieldType, 'mixed'> | null => {
  if (typeof v === 'string') return 'string';
  if (typeof v === 'number' && Number.isFinite(v)) return 'number';
  if (typeof v === 'boolean') return 'boolean';
  // null / undefined / arrays / nested objects don't contribute to type
  // inference — they'd just collapse everything into 'mixed'.
  return null;
};

export const stringifyFieldValue = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return '';
  }
};

export const mergeFieldType = (
  existing: FieldType | null,
  incoming: Set<Exclude<FieldType, 'mixed'>>,
): FieldType => {
  if (existing === 'mixed') return 'mixed';
  const incomingArr = [...incoming];
  if (incomingArr.length > 1) return 'mixed';
  const incomingType = incomingArr[0] ?? null;
  if (existing === null) return incomingType ?? 'string';
  if (incomingType === null) return existing;
  return existing === incomingType ? existing : 'mixed';
};

export const mergeTopValues = (
  existingJson: string | null,
  incoming: Map<string, number>,
): TopValueEntry[] => {
  const merged = new Map<string, number>();
  if (existingJson !== null && existingJson !== '') {
    try {
      const parsed = JSON.parse(existingJson) as unknown;
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const value = (item as { value?: unknown })?.value;
          const count = (item as { count?: unknown })?.count;
          if (typeof value === 'string' && typeof count === 'number') {
            merged.set(value, count);
          }
        }
      }
    } catch {
      /* corrupt blob — treat as empty */
    }
  }
  for (const [value, count] of incoming) {
    merged.set(value, (merged.get(value) ?? 0) + count);
  }
  return [...merged.entries()]
    .map(([value, count]): TopValueEntry => ({ value, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, FIELD_META_TOP_K);
};

/**
 * Walk a batch of entries once and group dynamic fields_json keys by
 * (sourceId, key). The result feeds the per-batch UPSERT into
 * `field_meta`. `file_path` is excluded — it lives in `entry.file_path`
 * (`@file` built-in) and `getFieldSchema` returns it from the built-in
 * list, never from this cache.
 */
export const aggregateFieldMeta = (
  entries: ReadonlyArray<LogEntry>,
): Map<SourceId, Map<string, FieldMetaAccum>> => {
  const out = new Map<SourceId, Map<string, FieldMetaAccum>>();
  for (const e of entries) {
    let perKey = out.get(e.sourceId);
    if (perKey === undefined) {
      perKey = new Map<string, FieldMetaAccum>();
      out.set(e.sourceId, perKey);
    }
    for (const [key, value] of Object.entries(e.fields)) {
      if (key === 'file_path') continue;
      let acc = perKey.get(key);
      if (acc === undefined) {
        acc = {
          occurrences: 0,
          types: new Set<Exclude<FieldType, 'mixed'>>(),
          topVals: new Map<string, number>(),
        };
        perKey.set(key, acc);
      }
      acc.occurrences += 1;
      const t = inferFieldType(value);
      if (t !== null) acc.types.add(t);
      const valStr = stringifyFieldValue(value);
      if (valStr !== '' && valStr.length <= FIELD_META_VALUE_MAX_CHARS) {
        acc.topVals.set(valStr, (acc.topVals.get(valStr) ?? 0) + 1);
      }
    }
  }
  return out;
};
