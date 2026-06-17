/**
 * Shared text-structuring helpers for plain-text log parsers.
 *
 * Most human-readable app logs encode two kinds of structure inside an
 * otherwise free-form line: a leading `[tag]` (service / category /
 * logger) and trailing `key=value` pairs (`reqId=… latency=…`). Pulling
 * these into `entry.fields` is what lets cross-format logical fields
 * (ADR-0030) and the column / group-by pickers work on text formats the
 * same way they do on JSON — a `field`-extractor reads `fields.service`
 * whether it came from a JSON key or this helper.
 *
 * Keeping the extraction here (rather than inline in one parser) is the
 * canonical way to add a new text format: a parser splits its line into
 * `level` / `timestamp` / `message` and then reuses these to surface the
 * embedded fields under canonical names.
 */

/** A leading bracket tag and the remaining text after it. */
export interface LeadingTag {
  readonly tag: string;
  readonly rest: string;
}

const LEADING_TAG_RE = /^\[([^\]]+)\]\s*/;

/**
 * Pull a leading `[tag]` off the front of `text` (e.g. the `[search]`
 * service marker in `[search] user logged in`). Returns `null` when the
 * text doesn't start with a bracket tag, so callers can leave `message`
 * untouched.
 */
export const extractLeadingTag = (text: string): LeadingTag | null => {
  const m = LEADING_TAG_RE.exec(text);
  if (m === null) return null;
  return { tag: m[1]!.trim(), rest: text.slice(m[0].length) };
};

// `key=value` where the value is either a double-quoted string or a run
// of non-whitespace. Keys look like identifiers (dots allowed for
// namespaced keys such as `http.status`).
const KV_RE = /(\b[A-Za-z_][\w.]*)=("[^"]*"|\S+)/g;

const coerce = (raw: string): string | number => {
  // Strip surrounding double quotes if present.
  const v =
    raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')
      ? raw.slice(1, -1)
      : raw;
  // Only coerce values that are purely numeric — `32` becomes a number,
  // but `32ms` / `req_000001` stay strings so they group as-is.
  if (v !== '' && /^-?\d+(?:\.\d+)?$/.test(v)) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return v;
};

/**
 * Extract `key=value` pairs from `text` into a plain object. Numeric
 * values are coerced to `number`; everything else stays a string.
 * Quoted values keep their inner content (`msg="a b"` → `a b`). On a
 * duplicate key the last occurrence wins.
 *
 * Non-destructive: the caller decides whether to also keep the pairs in
 * the human-readable `message`.
 */
export const extractKeyValues = (
  text: string,
): Record<string, string | number> => {
  const out: Record<string, string | number> = {};
  for (const m of text.matchAll(KV_RE)) {
    out[m[1]!] = coerce(m[2]!);
  }
  return out;
};
