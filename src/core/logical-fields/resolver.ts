import type { LogEntry } from '../types/log-entry.ts';
import type { LogicalExtractor, LogicalField } from '../types/logical-field.ts';

/**
 * Resolve a logical field against an entry by trying each extractor
 * in order. Returns the first non-null/non-undefined value, or
 * `null` if no extractor yielded one. Extractors with malformed
 * patterns are skipped (never throw).
 */
export const resolveLogicalField = (
  entry: LogEntry,
  field: LogicalField,
): unknown => {
  for (const ex of field.extractors) {
    const v = runExtractor(entry, ex);
    if (v !== null && v !== undefined) return v;
  }
  return null;
};

/**
 * Build a `(entry, id) => value` lookup over a set of logical fields.
 * Returns `null` when the id is unknown or no extractor matched.
 */
export const makeLogicalFieldResolver = (
  fields: ReadonlyArray<LogicalField>,
): ((entry: LogEntry, id: string) => unknown) => {
  const byId = new Map(fields.map((f) => [f.id, f]));
  return (entry, id) => {
    const f = byId.get(id);
    if (f === undefined) return null;
    return resolveLogicalField(entry, f);
  };
};

const runExtractor = (entry: LogEntry, ex: LogicalExtractor): unknown => {
  if (ex.type === 'field') {
    return readFieldPath(entry.fields, ex.path);
  }
  const text = ex.on === 'message' ? entry.message : entry.raw;
  if (typeof text !== 'string' || text.length === 0) return null;
  let re: RegExp;
  try {
    re = new RegExp(ex.pattern, ex.flags);
  } catch {
    return null;
  }
  const m = re.exec(text);
  if (m === null) return null;
  if (ex.group !== undefined) {
    return m.groups?.[ex.group] ?? null;
  }
  return m[1] ?? m[0] ?? null;
};

/**
 * Look up `path` ("a.b.c") inside `fields`. Dot is a property
 * separator. To address a literal key containing a dot, list a
 * separate extractor with the alternative path in the chain.
 */
const readFieldPath = (
  fields: Readonly<Record<string, unknown>>,
  path: string,
): unknown => {
  if (path.length === 0) return null;
  const parts = path.split('.');
  let cur: unknown = fields;
  for (const p of parts) {
    if (cur === null || cur === undefined) return null;
    if (typeof cur !== 'object') return null;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur ?? null;
};
