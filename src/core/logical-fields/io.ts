import { builtInLogicalField } from './catalog.ts';
import {
  isValidLogicalFieldId,
  type LogicalExtractor,
  type LogicalField,
  type LogicalFieldsConfig,
} from '../types/logical-field.ts';

/**
 * Export the user-visible part of the workspace logical-fields config
 * as a stable JSON document. `activeIds` and `customFields` are
 * preserved; built-in templates are not embedded — they ship with
 * the app and are referenced by id.
 */
export const exportLogicalFieldsConfig = (
  config: LogicalFieldsConfig,
): string => {
  const payload = {
    version: 1 as const,
    activeIds: config.activeIds,
    customFields: config.customFields,
  };
  return JSON.stringify(payload, null, 2);
};

const EXTRACTOR_TYPES: ReadonlySet<LogicalExtractor['type']> = new Set([
  'field',
  'regex',
  'regex-on-json',
]);

const parseExtractor = (raw: unknown): LogicalExtractor | string => {
  if (raw === null || typeof raw !== 'object')
    return 'extractor must be an object';
  const obj = raw as Record<string, unknown>;
  const t = obj.type;
  if (typeof t !== 'string' || !EXTRACTOR_TYPES.has(t as LogicalExtractor['type'])) {
    return `unknown extractor type: ${String(t)}`;
  }
  if (t === 'field') {
    if (typeof obj.path !== 'string') return 'field.path must be a string';
    return { type: 'field', path: obj.path };
  }
  if (t === 'regex') {
    if (obj.on !== 'message' && obj.on !== 'raw')
      return 'regex.on must be "message" or "raw"';
    if (typeof obj.pattern !== 'string')
      return 'regex.pattern must be a string';
    const out: LogicalExtractor = {
      type: 'regex',
      on: obj.on,
      pattern: obj.pattern,
    };
    return typeof obj.flags === 'string' || typeof obj.group === 'string'
      ? {
          ...out,
          ...(typeof obj.flags === 'string' ? { flags: obj.flags } : {}),
          ...(typeof obj.group === 'string' ? { group: obj.group } : {}),
        }
      : out;
  }
  // regex-on-json
  if (typeof obj.path !== 'string')
    return 'regex-on-json.path must be a string';
  if (typeof obj.pattern !== 'string')
    return 'regex-on-json.pattern must be a string';
  return {
    type: 'regex-on-json',
    path: obj.path,
    pattern: obj.pattern,
    ...(typeof obj.flags === 'string' ? { flags: obj.flags } : {}),
    ...(typeof obj.group === 'string' ? { group: obj.group } : {}),
  };
};

const parseField = (raw: unknown): LogicalField | string => {
  if (raw === null || typeof raw !== 'object')
    return 'customField must be an object';
  const obj = raw as Record<string, unknown>;
  const id = obj.id;
  if (typeof id !== 'string' || !isValidLogicalFieldId(id))
    return `invalid id: ${String(id)}`;
  if (builtInLogicalField(id) !== null)
    return `id collides with built-in template: ${id}`;
  const label = obj.label;
  if (typeof label !== 'string' || label.length === 0)
    return `invalid label for ${id}`;
  const type = obj.type;
  if (type !== 'string' && type !== 'number' && type !== 'bool')
    return `invalid type for ${id}: ${String(type)}`;
  const extractorsRaw = obj.extractors;
  if (!Array.isArray(extractorsRaw))
    return `${id}.extractors must be an array`;
  const extractors: LogicalExtractor[] = [];
  for (let i = 0; i < extractorsRaw.length; i++) {
    const parsed = parseExtractor(extractorsRaw[i]);
    if (typeof parsed === 'string') return `${id}.extractors[${i}]: ${parsed}`;
    extractors.push(parsed);
  }
  return {
    id,
    type,
    label,
    description: typeof obj.description === 'string' ? obj.description : undefined,
    extractors,
    origin: 'user',
  };
};

/**
 * Parse a previously-exported config JSON. Returns the parsed
 * `LogicalFieldsConfig` or a human-readable error string. Never
 * throws — callers can surface the message directly in the UI.
 */
export const parseLogicalFieldsConfig = (
  raw: string,
): LogicalFieldsConfig | string => {
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch (err) {
    return `Invalid JSON: ${(err as Error).message}`;
  }
  if (doc === null || typeof doc !== 'object')
    return 'Document must be a JSON object.';
  const obj = doc as Record<string, unknown>;
  const activeIds = obj.activeIds;
  if (!Array.isArray(activeIds) || activeIds.some((x) => typeof x !== 'string'))
    return 'activeIds must be an array of strings.';
  const customFieldsRaw = obj.customFields ?? [];
  if (!Array.isArray(customFieldsRaw))
    return 'customFields must be an array.';
  const customFields: LogicalField[] = [];
  const seenIds = new Set<string>();
  for (let i = 0; i < customFieldsRaw.length; i++) {
    const parsed = parseField(customFieldsRaw[i]);
    if (typeof parsed === 'string')
      return `customFields[${i}]: ${parsed}`;
    if (seenIds.has(parsed.id))
      return `customFields[${i}]: duplicate id ${parsed.id}`;
    seenIds.add(parsed.id);
    customFields.push(parsed);
  }
  return { activeIds: activeIds as string[], customFields };
};
