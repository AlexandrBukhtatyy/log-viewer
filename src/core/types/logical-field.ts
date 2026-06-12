/**
 * Logical field — a semantically named cross-format attribute (ADR-0030).
 *
 * Solves the problem where the same concept (`trace_id`, `user_id`,
 * `http.status`, …) lives under different keys/shapes in different
 * formats:
 *
 *     pino    →  fields.trace_id
 *     bunyan  →  fields.traceId
 *     nginx   →  fields.http_x_trace_id
 *     plain   →  regex on message
 *
 * A `LogicalField` is a named **chain** of extractors. The resolver
 * tries each extractor in order against a `LogEntry`; the first
 * non-null value wins (same model as Datadog Attribute Remapper's
 * `sources: [...]` array).
 *
 * Logical fields live in the `~`-namespace (`~trace_id`, `~user_id`,
 * `~http.status`) — separate from the `@`-builtins (`@ts`, `@level`,
 * `@source.name`) and from raw `fields` keys.
 *
 * Built-in templates ship disabled; the user activates the ones they
 * need from the Settings panel. Activations and user-defined fields
 * live in `LogicalFieldsConfig`, persisted alongside workspace state.
 */

export type LogicalFieldType = 'string' | 'number' | 'bool';

/**
 * Extractor: one attempt to pull a value out of an entry.
 *
 * - `field` — JSON-path lookup against `entry.fields`. Dots are
 *   property separators (`a.b.c` → `entry.fields.a.b.c`). To address
 *   a literal key containing a dot, list both forms in the chain.
 *
 * - `regex` — match against `entry.message` or `entry.raw`. When
 *   `group` is set, the named capture (`(?<group>…)`) is returned;
 *   otherwise the first capture group, then group 0.
 */
export type LogicalExtractor =
  | { readonly type: 'field'; readonly path: string }
  | {
      readonly type: 'regex';
      readonly on: 'message' | 'raw';
      readonly pattern: string;
      readonly flags?: string;
      readonly group?: string;
    };

export interface LogicalField {
  /**
   * Bare id — `trace_id`, `user_id`, `http.status`. Must match
   * `LOGICAL_FIELD_ID_RE`. The `~`-prefixed form (`~trace_id`)
   * is the FieldKey used by picker/filter/group plumbing.
   */
  readonly id: string;
  readonly type: LogicalFieldType;
  readonly label: string;
  readonly description?: string;
  readonly extractors: ReadonlyArray<LogicalExtractor>;
  readonly origin: 'builtin' | 'user';
}

/**
 * Workspace-wide config: which logical fields are currently active
 * (built-in or user-defined), plus the catalog of user-defined ones.
 * Built-in definitions are not stored here — they ship with the app
 * and are looked up by id from the built-in catalog.
 */
export interface LogicalFieldsConfig {
  readonly activeIds: ReadonlyArray<string>;
  readonly customFields: ReadonlyArray<LogicalField>;
}

export const EMPTY_LOGICAL_FIELDS_CONFIG: LogicalFieldsConfig = {
  activeIds: [],
  customFields: [],
};

/** Single-char prefix that marks the `~`-namespace. */
export const LOGICAL_FIELD_PREFIX = '~';

/** Valid bare-id shape. Dots are allowed for namespaced ids like `http.status`. */
export const LOGICAL_FIELD_ID_RE = /^[a-z_][a-z0-9_.]*$/;

export const isValidLogicalFieldId = (id: string): boolean =>
  LOGICAL_FIELD_ID_RE.test(id);

export const isLogicalFieldKey = (key: string): boolean =>
  key.startsWith(LOGICAL_FIELD_PREFIX);

export const logicalFieldKeyOf = (id: string): string =>
  `${LOGICAL_FIELD_PREFIX}${id}`;

export const logicalFieldIdOf = (key: string): string | null =>
  key.startsWith(LOGICAL_FIELD_PREFIX)
    ? key.slice(LOGICAL_FIELD_PREFIX.length)
    : null;

/**
 * Context passed to SQL/resolver helpers so they know how to expand
 * `~name` field keys into the underlying chain of extractors. Built-in
 * `@`-keys and dynamic JSON keys never read this — it's only the
 * `~`-namespace path that consults `activeLogicalFields`.
 *
 * Optional everywhere: callers that don't deal with logical fields can
 * keep ignoring it; a `~`-key without a matching active definition
 * compiles to SQL `NULL` (and resolves to JS `null`), mirroring the
 * read-path resolver behaviour for an unknown chain.
 */
export interface LogicalFieldsCtx {
  readonly activeLogicalFields?: ReadonlyArray<LogicalField>;
}
