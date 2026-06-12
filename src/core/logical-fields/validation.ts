import { builtInLogicalField } from './catalog.ts';
import {
  isValidLogicalFieldId,
  type LogicalField,
  type LogicalExtractor,
  type LogicalFieldsConfig,
} from '../types/logical-field.ts';

/**
 * Pure validation helpers for user-defined logical fields (ADR-0030).
 * Mirrored on the store side via `addCustom`/`updateCustom`, which
 * throw on the same conditions, but exposed here for inline UI
 * preview without forcing the editor through a try/catch dance.
 *
 * Every function returns a human-readable error string or `null`
 * when the input is valid.
 */

export const validateLogicalFieldId = (
  id: string,
  config: LogicalFieldsConfig,
  selfId: string | null,
): string | null => {
  if (id.length === 0) return 'Id is required.';
  if (!isValidLogicalFieldId(id)) {
    return 'Id must start with a lowercase letter or underscore and contain only [a-z0-9_.].';
  }
  if (builtInLogicalField(id) !== null) {
    return `Id "${id}" collides with a built-in template.`;
  }
  if (
    config.customFields.some((f) => f.id === id && f.id !== selfId)
  ) {
    return `Id "${id}" is already used by another custom field.`;
  }
  return null;
};

export const validateLabel = (label: string): string | null =>
  label.trim().length === 0 ? 'Label is required.' : null;

export const validateExtractor = (
  ex: LogicalExtractor,
): string | null => {
  if (ex.type === 'field') {
    if (ex.path.trim().length === 0) return 'Field path is required.';
    return null;
  }
  // regex
  if (ex.pattern.trim().length === 0) return 'Regex pattern is required.';
  try {
    new RegExp(ex.pattern, ex.flags);
  } catch (err) {
    return `Invalid regex: ${(err as Error).message}`;
  }
  if (ex.group !== undefined && ex.group.length > 0) {
    const named = ex.pattern.match(/\(\?<([A-Za-z_][A-Za-z0-9_]*)>/g);
    if (named === null || !named.some((g) => g.includes(`<${ex.group}>`))) {
      return `Pattern has no named group "${ex.group}".`;
    }
  }
  return null;
};

export const validateLogicalField = (
  field: LogicalField,
  config: LogicalFieldsConfig,
  selfId: string | null,
): string | null => {
  const idErr = validateLogicalFieldId(field.id, config, selfId);
  if (idErr !== null) return idErr;
  const labelErr = validateLabel(field.label);
  if (labelErr !== null) return labelErr;
  if (field.extractors.length === 0) {
    return 'At least one extractor is required.';
  }
  for (let i = 0; i < field.extractors.length; i++) {
    const err = validateExtractor(field.extractors[i]!);
    if (err !== null) return `Extractor ${i + 1}: ${err}`;
  }
  return null;
};
