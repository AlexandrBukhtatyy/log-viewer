import type {
  LogicalField,
  LogicalFieldsConfig,
} from '../types/logical-field.ts';

/**
 * Built-in logical field templates — a curated baseline of common
 * cross-format concepts, modelled after Datadog Standard Attributes
 * and Elastic Common Schema.
 *
 * All templates ship **disabled**; the user opts in from the Settings
 * panel. Extractor chains cover the conventions our shipping parsers
 * (json-lines / pino / bunyan, nginx-combined, syslog, app-text)
 * produce, plus a regex fallback for plain text where applicable.
 * Order matters: cheaper field lookups first, regex last.
 */
export const BUILT_IN_LOGICAL_FIELDS: ReadonlyArray<LogicalField> = [
  {
    id: 'trace_id',
    type: 'string',
    label: 'Trace id',
    description: 'Distributed trace identifier (W3C trace-context / OTEL).',
    origin: 'builtin',
    extractors: [
      { type: 'field', path: 'trace_id' },
      { type: 'field', path: 'traceId' },
      { type: 'field', path: 'tid' },
      { type: 'field', path: 'dd.trace_id' },
      { type: 'field', path: 'http_x_trace_id' },
      {
        type: 'regex',
        on: 'message',
        pattern: 'tr[ace]?[_-]?id[=:]\\s*(?<v>[\\w-]+)',
        flags: 'i',
        group: 'v',
      },
    ],
  },
  {
    id: 'span_id',
    type: 'string',
    label: 'Span id',
    description: 'Span/operation identifier within a trace.',
    origin: 'builtin',
    extractors: [
      { type: 'field', path: 'span_id' },
      { type: 'field', path: 'spanId' },
      { type: 'field', path: 'sid' },
    ],
  },
  {
    id: 'request_id',
    type: 'string',
    label: 'Request id',
    description: 'Per-request identifier propagated across services.',
    origin: 'builtin',
    extractors: [
      { type: 'field', path: 'request_id' },
      { type: 'field', path: 'requestId' },
      { type: 'field', path: 'reqId' },
      { type: 'field', path: 'req_id' },
      { type: 'field', path: 'http_x_request_id' },
      {
        type: 'regex',
        on: 'message',
        pattern: 'req[_-]?id[=:]\\s*(?<v>[\\w-]+)',
        flags: 'i',
        group: 'v',
      },
    ],
  },
  {
    id: 'user_id',
    type: 'string',
    label: 'User id',
    description: 'End-user identifier.',
    origin: 'builtin',
    extractors: [
      { type: 'field', path: 'user_id' },
      { type: 'field', path: 'userId' },
      { type: 'field', path: 'usr.id' },
      { type: 'field', path: 'uid' },
    ],
  },
  {
    id: 'session_id',
    type: 'string',
    label: 'Session id',
    description: 'User session identifier.',
    origin: 'builtin',
    extractors: [
      { type: 'field', path: 'session_id' },
      { type: 'field', path: 'sessionId' },
      { type: 'field', path: 'session.id' },
    ],
  },
  {
    id: 'service',
    type: 'string',
    label: 'Service',
    description: 'Logical service name (OTEL service.name).',
    origin: 'builtin',
    extractors: [
      { type: 'field', path: 'service' },
      { type: 'field', path: 'service.name' },
      { type: 'field', path: 'logger' },
    ],
  },
  {
    id: 'host',
    type: 'string',
    label: 'Host',
    description: 'Machine / instance hostname.',
    origin: 'builtin',
    extractors: [
      { type: 'field', path: 'host' },
      { type: 'field', path: 'hostname' },
      { type: 'field', path: 'host.name' },
    ],
  },
  {
    id: 'http.method',
    type: 'string',
    label: 'HTTP method',
    description: 'GET / POST / PUT / … request method.',
    origin: 'builtin',
    extractors: [
      { type: 'field', path: 'http.method' },
      { type: 'field', path: 'method' },
    ],
  },
  {
    id: 'http.status',
    type: 'number',
    label: 'HTTP status',
    description: 'HTTP response status code.',
    origin: 'builtin',
    extractors: [
      { type: 'field', path: 'http.status_code' },
      { type: 'field', path: 'status' },
      { type: 'field', path: 'response_code' },
    ],
  },
  {
    id: 'http.path',
    type: 'string',
    label: 'HTTP path',
    description: 'Request URI / path.',
    origin: 'builtin',
    extractors: [
      { type: 'field', path: 'http.url' },
      { type: 'field', path: 'request_uri' },
      { type: 'field', path: 'path' },
    ],
  },
  {
    id: 'error.kind',
    type: 'string',
    label: 'Error kind',
    description: 'Exception / error type name.',
    origin: 'builtin',
    extractors: [
      { type: 'field', path: 'error.kind' },
      { type: 'field', path: 'exception_type' },
      { type: 'field', path: 'err.type' },
    ],
  },
  {
    id: 'error.message',
    type: 'string',
    label: 'Error message',
    description: 'Exception / error message.',
    origin: 'builtin',
    extractors: [
      { type: 'field', path: 'error.message' },
      { type: 'field', path: 'err.message' },
      { type: 'field', path: 'exception_message' },
    ],
  },
];

const BUILT_IN_BY_ID: ReadonlyMap<string, LogicalField> = new Map(
  BUILT_IN_LOGICAL_FIELDS.map((f) => [f.id, f]),
);

export const builtInLogicalField = (id: string): LogicalField | null =>
  BUILT_IN_BY_ID.get(id) ?? null;

/**
 * Resolve `config.activeIds` into actual `LogicalField` definitions,
 * preferring a user-defined custom field over a built-in template
 * when both share the same id. Ids that match neither are silently
 * skipped — they survive in `activeIds` so a re-installed template
 * lights back up, but no resolver work is wasted on them.
 */
export const resolveActiveLogicalFields = (
  config: LogicalFieldsConfig,
): ReadonlyArray<LogicalField> => {
  const customById = new Map(config.customFields.map((f) => [f.id, f]));
  const out: LogicalField[] = [];
  for (const id of config.activeIds) {
    const f = customById.get(id) ?? builtInLogicalField(id);
    if (f !== null && f !== undefined) out.push(f);
  }
  return out;
};
