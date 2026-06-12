import { describe, expect, it } from 'vitest';
import {
  EMPTY_LOGICAL_FIELDS_CONFIG,
  type LogicalField,
} from '../types/index.ts';
import {
  validateExtractor,
  validateLabel,
  validateLogicalField,
  validateLogicalFieldId,
} from './validation.ts';

const userField = (
  id: string,
  extractors: LogicalField['extractors'] = [{ type: 'field', path: id }],
): LogicalField => ({
  id,
  type: 'string',
  label: id,
  origin: 'user',
  extractors,
});

describe('validateLogicalFieldId', () => {
  it('passes a clean new id', () => {
    expect(
      validateLogicalFieldId(
        'audit_id',
        EMPTY_LOGICAL_FIELDS_CONFIG,
        null,
      ),
    ).toBeNull();
  });

  it('rejects empty id', () => {
    expect(
      validateLogicalFieldId('', EMPTY_LOGICAL_FIELDS_CONFIG, null),
    ).toMatch(/required/i);
  });

  it('rejects malformed id', () => {
    expect(
      validateLogicalFieldId(
        'Bad Id',
        EMPTY_LOGICAL_FIELDS_CONFIG,
        null,
      ),
    ).toMatch(/lowercase/i);
  });

  it('rejects collision with built-in', () => {
    expect(
      validateLogicalFieldId(
        'trace_id',
        EMPTY_LOGICAL_FIELDS_CONFIG,
        null,
      ),
    ).toMatch(/built-in/i);
  });

  it('rejects duplicate custom id (when adding new)', () => {
    expect(
      validateLogicalFieldId(
        'audit_id',
        {
          activeIds: [],
          customFields: [userField('audit_id')],
        },
        null,
      ),
    ).toMatch(/already used/i);
  });

  it('allows editing a custom field — same id stays valid', () => {
    expect(
      validateLogicalFieldId(
        'audit_id',
        {
          activeIds: [],
          customFields: [userField('audit_id')],
        },
        'audit_id',
      ),
    ).toBeNull();
  });
});

describe('validateLabel', () => {
  it('rejects empty label', () => {
    expect(validateLabel('')).toMatch(/required/i);
    expect(validateLabel('   ')).toMatch(/required/i);
  });

  it('accepts non-empty label', () => {
    expect(validateLabel('Audit id')).toBeNull();
  });
});

describe('validateExtractor', () => {
  it('field extractor with non-empty path passes', () => {
    expect(validateExtractor({ type: 'field', path: 'service.name' })).toBeNull();
  });

  it('field extractor with empty path fails', () => {
    expect(validateExtractor({ type: 'field', path: '' })).toMatch(/required/i);
  });

  it('regex extractor with valid pattern passes', () => {
    expect(
      validateExtractor({
        type: 'regex',
        on: 'message',
        pattern: 'tr=(\\w+)',
      }),
    ).toBeNull();
  });

  it('regex extractor with empty pattern fails', () => {
    expect(
      validateExtractor({ type: 'regex', on: 'message', pattern: '' }),
    ).toMatch(/required/i);
  });

  it('regex extractor with malformed pattern fails', () => {
    expect(
      validateExtractor({ type: 'regex', on: 'message', pattern: '(' }),
    ).toMatch(/invalid regex/i);
  });

  it('regex extractor with missing named group fails', () => {
    expect(
      validateExtractor({
        type: 'regex',
        on: 'message',
        pattern: 'tr=(\\w+)',
        group: 'v',
      }),
    ).toMatch(/no named group/i);
  });

  it('regex extractor with matching named group passes', () => {
    expect(
      validateExtractor({
        type: 'regex',
        on: 'message',
        pattern: 'tr=(?<v>\\w+)',
        group: 'v',
      }),
    ).toBeNull();
  });
});

describe('validateLogicalField', () => {
  it('passes a well-formed custom field', () => {
    expect(
      validateLogicalField(
        userField('audit_id', [{ type: 'field', path: 'audit.id' }]),
        EMPTY_LOGICAL_FIELDS_CONFIG,
        null,
      ),
    ).toBeNull();
  });

  it('rejects when extractor list is empty', () => {
    expect(
      validateLogicalField(
        userField('audit_id', []),
        EMPTY_LOGICAL_FIELDS_CONFIG,
        null,
      ),
    ).toMatch(/at least one extractor/i);
  });

  it('reports the position of a broken extractor', () => {
    expect(
      validateLogicalField(
        userField('audit_id', [
          { type: 'field', path: 'audit.id' },
          { type: 'regex', on: 'message', pattern: '(' },
        ]),
        EMPTY_LOGICAL_FIELDS_CONFIG,
        null,
      ),
    ).toMatch(/extractor 2/i);
  });
});
