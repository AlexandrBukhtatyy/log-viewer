import { describe, expect, it } from 'vitest';
import type { LogicalFieldsConfig } from '../types/index.ts';
import { exportLogicalFieldsConfig, parseLogicalFieldsConfig } from './io.ts';

const baseConfig: LogicalFieldsConfig = {
  activeIds: ['trace_id', 'audit_id'],
  customFields: [
    {
      id: 'audit_id',
      type: 'string',
      label: 'Audit id',
      origin: 'user',
      extractors: [
        { type: 'field', path: 'audit.id' },
        {
          type: 'regex',
          on: 'message',
          pattern: 'audit=(?<v>\\w+)',
          group: 'v',
        },
      ],
    },
  ],
};

describe('exportLogicalFieldsConfig', () => {
  it('round-trips through parseLogicalFieldsConfig', () => {
    const raw = exportLogicalFieldsConfig(baseConfig);
    const parsed = parseLogicalFieldsConfig(raw);
    expect(parsed).toEqual(baseConfig);
  });

  it('preserves regex-on-json shape', () => {
    const cfg: LogicalFieldsConfig = {
      activeIds: ['x'],
      customFields: [
        {
          id: 'x',
          type: 'string',
          label: 'X',
          origin: 'user',
          extractors: [
            {
              type: 'regex-on-json',
              path: 'ctx',
              pattern: 'k=(?<v>\\w+)',
              group: 'v',
              flags: 'i',
            },
          ],
        },
      ],
    };
    expect(parseLogicalFieldsConfig(exportLogicalFieldsConfig(cfg))).toEqual(
      cfg,
    );
  });
});

describe('parseLogicalFieldsConfig', () => {
  it('rejects malformed JSON', () => {
    expect(parseLogicalFieldsConfig('{not json')).toMatch(/invalid json/i);
  });

  it('rejects non-array activeIds', () => {
    expect(parseLogicalFieldsConfig('{"activeIds": "x"}')).toMatch(/activeIds/);
  });

  it('rejects a custom field with a built-in id', () => {
    const raw = JSON.stringify({
      activeIds: [],
      customFields: [
        {
          id: 'trace_id',
          type: 'string',
          label: 'X',
          extractors: [{ type: 'field', path: 'x' }],
        },
      ],
    });
    expect(parseLogicalFieldsConfig(raw)).toMatch(/built-in/i);
  });

  it('rejects an unknown extractor type', () => {
    const raw = JSON.stringify({
      activeIds: [],
      customFields: [
        {
          id: 'audit_id',
          type: 'string',
          label: 'A',
          extractors: [{ type: 'bogus' }],
        },
      ],
    });
    expect(parseLogicalFieldsConfig(raw)).toMatch(/unknown extractor type/i);
  });

  it('rejects a duplicate custom id', () => {
    const raw = JSON.stringify({
      activeIds: [],
      customFields: [
        {
          id: 'audit_id',
          type: 'string',
          label: 'A',
          extractors: [{ type: 'field', path: 'a' }],
        },
        {
          id: 'audit_id',
          type: 'string',
          label: 'B',
          extractors: [{ type: 'field', path: 'b' }],
        },
      ],
    });
    expect(parseLogicalFieldsConfig(raw)).toMatch(/duplicate/i);
  });
});
