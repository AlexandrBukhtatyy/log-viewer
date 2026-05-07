import type { LogEntry, SourceId } from '../../core/types/index.ts';
import type { FieldDescriptor } from '../../core/filter/field-descriptor.ts';

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
 * Row shape returned by SELECTing from `field_meta`. Mirrors the table
 * columns; coercion to numbers / parse of `top_values_json` happens in
 * `aggregateFieldDescriptors`.
 */
export interface FieldMetaRow {
  readonly key: string;
  readonly type: string;
  readonly occurrences: number | null;
  readonly total_seen: number | null;
  readonly top_values_json: string | null;
}

/**
 * Aggregate `field_meta` rows from one or more sources into a single
 * `FieldDescriptor` per key. Sums occurrences/total_seen, unions types
 * (collapsing to `'mixed'` when more than one concrete type appears),
 * and merges + caps top-K values to `FIELD_META_TOP_K`.
 *
 * Pure JS — no SQL — so the merge logic stays unit-testable without
 * spinning up a full indexer worker.
 */
export const aggregateFieldDescriptors = (
  rows: ReadonlyArray<FieldMetaRow>,
): ReadonlyArray<FieldDescriptor> => {
  interface Acc {
    types: Set<Exclude<FieldType, 'mixed'>>;
    sawMixed: boolean;
    occurrences: number;
    totalSeen: number;
    topVals: Map<string, number>;
  }
  const byKey = new Map<string, Acc>();
  for (const r of rows) {
    if (r.key === '') continue;
    let acc = byKey.get(r.key);
    if (acc === undefined) {
      acc = {
        types: new Set(),
        sawMixed: false,
        occurrences: 0,
        totalSeen: 0,
        topVals: new Map(),
      };
      byKey.set(r.key, acc);
    }
    acc.occurrences += Number(r.occurrences ?? 0);
    acc.totalSeen += Number(r.total_seen ?? 0);
    if (r.type === 'mixed') acc.sawMixed = true;
    else if (r.type === 'string' || r.type === 'number' || r.type === 'boolean') {
      acc.types.add(r.type);
    }
    if (r.top_values_json !== null && r.top_values_json !== '') {
      try {
        const parsed = JSON.parse(r.top_values_json) as unknown;
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            const value = (item as { value?: unknown })?.value;
            const count = (item as { count?: unknown })?.count;
            if (typeof value === 'string' && typeof count === 'number') {
              acc.topVals.set(value, (acc.topVals.get(value) ?? 0) + count);
            }
          }
        }
      } catch {
        /* corrupt blob — skip */
      }
    }
  }

  const out: FieldDescriptor[] = [];
  for (const [key, acc] of byKey) {
    const merged = mergeFieldType(acc.sawMixed ? 'mixed' : null, acc.types);
    const presenceRate =
      acc.totalSeen > 0 ? acc.occurrences / acc.totalSeen : undefined;
    const topValues = [...acc.topVals.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, FIELD_META_TOP_K);
    out.push({
      key,
      label: key,
      type: merged,
      origin: 'dynamic',
      occurrences: acc.occurrences,
      ...(presenceRate !== undefined ? { presenceRate } : {}),
      ...(topValues.length > 0 ? { topValues } : {}),
    });
  }
  out.sort((a, b) => {
    const occDiff = (b.occurrences ?? 0) - (a.occurrences ?? 0);
    if (occDiff !== 0) return occDiff;
    return a.key.localeCompare(b.key);
  });
  return out;
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
